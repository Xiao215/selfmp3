import { z } from 'zod/v4'
import type { AskAnswer } from '@selfmp3/shared'
import {
  ASK_ACTIONS,
  type AskAction,
  type AskAllowed,
  type AskContext,
  type AskDeps,
} from './askActions.js'
import { none } from './askLibrary.js'
import { FILTERS_GUIDE, PlanOut } from './describe.js'
import { libraryShape, songTable } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'

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
 * A follow-up ("only the albums", "skip the Inazuma ones") is asked again with
 * everything said before it, as one request (`followed`): the router and the
 * action it chooses read the whole of it, so the answer is the earlier one
 * changed, not a new question with nothing before it.
 */

const VERSION = 14

const FALLBACK =
  'Ask for music (a playlist, something to play now), to skip, pause or go back in what is playing, a song you half remember, changes to your tags or playlists, or a question about your library or your listening.'

/** What the router fills in, as this file reads it; each action's part is under its name. */
type Route = Record<string, unknown> & {
  action: string
  filters: z.infer<typeof PlanOut> | null
  say: string | null
  try: string[] | null
}

/** Everything said, first ask first, as the one request the router and the actions read. */
export function followed(text: string, before: readonly string[]): string {
  if (before.length === 0) return text
  const [first, ...then] = before
  return [
    `They first asked: ${first}`,
    ...then.map(said => `Then they said: ${said}`),
    `Now they say: ${text}`,
    '(Answer all of it together: the latest words change what was asked before.)',
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
- none: anything else, including talk that is not a request, or a request missing what it needs. "say" is one plain sentence on what you can do instead, and "try" is up to two requests, in their language, that this box can do and that come closest to what they wanted (for "tag the good ones": "tag the songs that should be 中文流行"). Empty when nothing comes close. Never pretend to do something.

"filters", for ${filtered.join(', ')}:
${FILTERS_GUIDE}`
}

const FORM = routeForm(ASK_ACTIONS)
const SYSTEM = routeSystem(ASK_ACTIONS)

export async function ask(
  deps: AskDeps,
  text: string,
  playingId: number | null = null,
  allowed: AskAllowed = { tidy: true, tags: true },
  /** Told each stage as it begins, for the device's waiting steps (`progress.ts`). */
  steps: Steps = NO_STEPS,
  /** What was said before, when this follows up on an answer. */
  before: readonly string[] = [],
): Promise<AskAnswer> {
  const request = withNotes(followed(text, before), deps.notes?.() ?? [])
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()

  const playing = songs.find(song => song.id === playingId)
  // "This", for the router and for the pick: the song as the table draws a row.
  const nowPlaying = playing
    ? `\n\nNow playing: ${songTable([playing], tags, now).replace(/^#1 \| /, '')}`
    : ''
  const playlists = deps.playlists?.() ?? []
  const prompt = `${libraryShape(songs, tags)}\n\nTheir tags, exactly: ${tags.map(tag => tag.name).join(', ') || '(none)'}\n\nTheir playlists, exactly: ${playlists.map(playlist => playlist.name).join(' | ') || '(none)'}${nowPlaying}\n\nThe request:\n${request}`
  steps.begin('Reading what you asked')
  const route = await remembered.get(
    Remembered.key('ask-route', VERSION, prompt),
    async () =>
      (
        await deps.llm.generate({
          task: 'ask-route',
          tier: 'fast',
          system: SYSTEM,
          prompt,
          schema: FORM,
        })
      ).value,
  )
  steps.done('Read what you asked')

  const chosen = ASK_ACTIONS.find(each => each.name === route.action)
  // An action without what it needs is not trusted: it falls through to "none".
  const fields = chosen?.fields ? route[chosen.name] : null
  if (
    !chosen ||
    (chosen.fields && (fields === null || fields === undefined)) ||
    (chosen.filters === 'required' && route.filters === null)
  ) {
    return none(route.say ?? FALLBACK, route.try ?? [])
  }
  if (chosen.switch && !allowed[chosen.switch.key]) {
    return none(`${chosen.switch.label} is turned off in Settings › Smart features.`)
  }
  const context: AskContext = {
    deps: { ...deps, remembered },
    text: request,
    playing,
    nowPlaying,
    playlists,
    now,
    steps,
  }
  return chosen.run(context, fields, chosen.filters === 'unused' ? null : route.filters)
}
