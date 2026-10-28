import { z } from 'zod/v4'
import type { AskAnswer, AskRequest, AskTurn, Song } from '@selfmp3/shared'
import { ASK_ACTIONS, type AskAction, type AskContext, type AskDeps } from './askActions.js'
import { none, rulesWords } from './askLibrary.js'
import { FILTERS_GUIDE, PlanOut } from './describe.js'
import { libraryShape, songTable } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { objectLines, type Held } from './scope.js'

/**
 * S1 · the Search box's Ask (docs/features/ai.md).
 *
 * A router: one call reads the request against the library's shape and
 * chooses one of the actions in `askActions.ts`, filling in what that action
 * needs; then the action runs as code. The prompt and the form the model fills
 * are both built from that list, so this file is the same whatever the
 * actions are: route, check that the chosen action got what it needs and is
 * switched on, run it. Every answer is a proposal: nothing here writes.
 *
 * The form is one object with every action's part, those not chosen null,
 * rather than one shape per action: it is what an OpenAI-style json_schema
 * endpoint takes reliably.
 *
 * A follow-up is asked after the conversation before it (`followed`): each
 * earlier question with what was shown for it, and what each answer showed as
 * objects named by handle (`t2.1`), their songs numbered. The router and the
 * action it chooses answer the newest words, reading the rest as what they
 * follow on from: a question about what was just said, a change to a list
 * shown, or something done with songs an answer showed, named by handle and
 * place (`scope.ts`) rather than described again. The answer on the device's
 * screen (`context.screen`) is what words pointing at songs mean.
 */

const FALLBACK =
  'Ask for music (a playlist, something to play now), to skip, pause or go back in what is playing, a song you half remember, changes to your tags or playlists, or a question about your library or your listening.'

/** What the router fills in, as this file reads it; each action's part is under its name. */
type Route = Record<string, unknown> & {
  action: string
  filters: z.infer<typeof PlanOut> | null
  say: string | null
  try: string[] | null
}

/**
 * The request as the router and the actions read it: what they say now, after
 * the conversation so far. Each earlier turn comes with what was shown for it,
 * so it is context and not asked again: the newest words are what is answered.
 * What the answers showed is set out by handle, the one on their screen
 * first, each with its songs numbered (`objectLines`), so a follow-up names
 * them by handle and place.
 */
export function followed(
  text: string,
  before: readonly AskTurn[],
  screen: string | null = null,
  songs: ReadonlyMap<number, Song> = new Map(),
): string {
  if (before.length === 0) return text
  const objects = before.flatMap(turn => turn.objects)
  const onScreen = objects.find(object => object.handle === screen)
  const shown = onScreen ? [onScreen, ...objects.filter(object => object !== onScreen)] : objects
  return [
    'Earlier in this conversation:',
    ...before.flatMap(turn => [
      `They asked: ${turn.asked}`,
      `You answered: ${turn.answered || '(nothing)'}`,
      ...(turn.objects.length > 0
        ? [`It showed: ${turn.objects.map(object => object.handle).join(', ')}`]
        : []),
    ]),
    ...(shown.length > 0
      ? [
          '',
          'What the answers showed, by handle:',
          ...shown.map(object => objectLines(object, songs)),
        ]
      : []),
    '',
    onScreen
      ? `On their screen now: ${onScreen.handle}. Words that point at songs without saying where they are point at its songs.`
      : 'Nothing from this conversation is on their screen now.',
    '',
    `Now they say: ${text}`,
    '(Answer what they say now. The earlier turns are what it follows on from, not questions to answer again; when it changes something asked before, the answer is that earlier request changed. Songs an answer showed are named by its handle and their places in its list, never described again. Write anything for them in the language of what they say now, whatever language the earlier turns are in.)',
  ].join('\n')
}

/** The request with their standing preferences after it, when they have any. */
export function withNotes(request: string, notes: readonly string[]): string {
  if (notes.length === 0) return request
  return `${request}\n\nTheir standing preferences (follow them unless these words say otherwise):\n${notes.map(note => `- ${note}`).join('\n')}`
}

/** The router's form for these actions: which one, the shared filters, each one's part, and a way out. */
export function routeForm(actions: readonly AskAction<unknown>[]): z.ZodType<Route> {
  const parts = Object.fromEntries(
    actions.flatMap(each => (each.fields ? [[each.name, each.fields.nullable()]] : [])),
  )
  const [first = 'none', ...rest] = [...actions.map(each => each.name), 'none']
  return z.object({
    action: z.enum([first, ...rest]),
    /** Describe's plan, for the actions that read it. */
    filters: PlanOut.nullable(),
    ...parts,
    /** none: one plain sentence for the person. */
    say: z.string().max(240).nullable(),
    /** none: requests the box can do that come closest, in their words. */
    try: z.array(z.string().max(120)).max(2).nullable(),
  })
}

/** The router's instructions for these actions, each in its own words. */
export function routeSystem(actions: readonly AskAction<unknown>[]): string {
  const fielded = actions.filter(each => each.fields).map(each => `"${each.name}"`)
  const filtered = actions.filter(each => each.filters !== 'unused').map(each => each.name)
  return `You are the request box of someone's own music app. Turn one request into exactly one action over their library, as JSON in the schema given. Set every field; the fields the chosen action does not use are null (${fielded.join(', ')}, "filters", "say" and "try" alike).

The actions:
${actions.map(each => `- ${each.name}: ${each.when}`).join('\n')}
- none: anything else, including talk that is not a request, or a request missing what it needs. "say" is one plain sentence, in the language of their newest words, on what you can do instead, and "try" is up to two requests, in their language, that this box can do and that come closest to what they wanted (for "tag the good ones": "tag the songs that should be 中文流行"). Empty when nothing comes close. Never pretend to do something.

"filters", for ${filtered.join(', ')}:
${FILTERS_GUIDE}`
}

const FORM = routeForm(ASK_ACTIONS)
const SYSTEM = routeSystem(ASK_ACTIONS)

export async function ask(
  deps: AskDeps,
  text: string,
  /** The song playing on the device and the answer on its screen. */
  where: AskRequest['context'] = { playing: null, screen: null },
  /** Told each stage as it begins, for the device's waiting steps (`progress.ts`). */
  steps: Steps = NO_STEPS,
  /** The conversation before this, when it follows up on an answer. */
  before: readonly AskTurn[] = [],
): Promise<AskAnswer> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()
  const byId = new Map(songs.map(song => [song.id, song]))
  const request = withNotes(followed(text, before, where.screen, byId), deps.notes?.() ?? [])

  const playing = where.playing === null ? undefined : byId.get(where.playing)
  // What the handles name: the song playing, and what each earlier answer showed.
  const held: Held = { playing, objects: before.flatMap(turn => turn.objects) }
  // "This", for the router and for the pick: the song as the table draws a row.
  const nowPlaying = playing
    ? `\n\nNow playing: ${songTable([playing], tags, now).replace(/^#1 \| /, '')}`
    : ''
  const playlists = deps.playlists?.() ?? []
  // Each playlist with its kind: a live one's songs come from its rules, said in words.
  const playlistLines = playlists.map(
    playlist =>
      `- “${playlist.name}”: ${playlist.kind === 'live' && playlist.rules ? `live, holds ${rulesWords(playlist.rules, tags)}` : playlist.kind}`,
  )
  const prompt = `${libraryShape(songs, tags, deps.artistNames?.())}\n\nTheir tags, exactly: ${tags.map(tag => tag.name).join(', ') || '(none)'}\n\nTheir playlists, each name exactly as quoted, and whether it is manual (songs put in by hand) or live (filled by its rules):\n${playlistLines.join('\n') || '(none)'}${nowPlaying}\n\nThe request:\n${request}`
  // Not remembered: asked again, the same words are read again, so Try again can come out differently.
  const route = (more = ''): Promise<Route> =>
    deps.llm
      .generate({
        task: 'ask-route',
        tier: 'fast',
        system: SYSTEM,
        prompt: prompt + more,
        schema: FORM,
      })
      .then(answer => answer.value)
  steps.begin('Reading what you asked')
  let routed = await route()
  let missing = missingFrom(routed)
  if (missing) {
    // An action without what it needs is not trusted: the model is asked once more, told what it left out.
    routed = await route(
      `\n\n(Your last answer chose ${routed.action} and left "${missing}" empty. Answer again with it filled in, or choose none and say, in the language of their newest words, what you need to know.)`,
    )
    missing = missingFrom(routed)
  }
  steps.done('Read what you asked')

  const chosen = ASK_ACTIONS.find(each => each.name === routed.action)
  if (!chosen || missing) {
    // Asked twice and still without it: said, in the model's words when it gave any.
    const unsure =
      missing === 'filters'
        ? 'I couldn’t tell which songs you mean. Say an artist, an album, a tag or a kind of music.'
        : 'I couldn’t tell all of what you want done. Say it another way.'
    return none(routed.say ?? (missing ? unsure : FALLBACK), routed.try ?? [])
  }
  const fields = chosen.fields ? routed[chosen.name] : null
  const context: AskContext = {
    deps: { ...deps, remembered },
    text: request,
    words: text,
    before,
    held,
    playing,
    nowPlaying,
    playlists,
    now,
    steps,
  }
  return chosen.run(context, fields, chosen.filters === 'unused' ? null : routed.filters)
}

/** The part of the form the chosen action needs and the router left empty, or null. */
function missingFrom(route: Route): string | null {
  const chosen = ASK_ACTIONS.find(each => each.name === route.action)
  if (!chosen) return null
  if (chosen.fields && (route[chosen.name] === null || route[chosen.name] === undefined)) {
    return chosen.name
  }
  if (chosen.filters === 'required' && route.filters === null) return 'filters'
  return chosen.missing?.(route[chosen.name], route.filters) ?? null
}
