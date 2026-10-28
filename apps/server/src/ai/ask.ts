import type { AskReply, AskRequest, AskTurn, Song } from '@selfmp3/shared'
import { rulesWords } from './askLibrary.js'
import { askTools, libraryOf, type AskDeps } from './askTools.js'
import { libraryShape, songTable } from './library.js'
import { Remembered, tool, type LlmTool } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { CARD_KINDS, respond, RespondArgs, RespondProblems, type Responding } from './respond.js'
import { objectLines, type Held } from './scope.js'
import { WorkingSet } from './workingSet.js'

/**
 * S1 · the Search box's Ask (docs/features/ai.md), as a grounded agent
 * (AGENT-DESIGN 2.5–2.6).
 *
 * One model, on the smart tier, reads the request with the library's shape,
 * the playlists, the conversation so far and what the device has playing and
 * on its screen, and answers by calling tools: Ask's pipelines (`askTools.ts`)
 * over the request's working set (`workingSet.ts`), then the terminal
 * `respond` (`respond.ts`), which builds the reply's cards from the sets and
 * proposals the tools left and checks them in code. It plans ahead: the calls
 * it can foresee go in one reply, chained by the sets they name, ending with
 * `respond` when it needn't see their results, so a request costs one round
 * when nothing goes wrong. It looks again only when it must see what came
 * back, and a check that fails goes back to it once.
 *
 * After `ROUNDS` rounds or `BUDGET_MS` of time no tool is offered, and it
 * writes `respond`'s arguments as its answer, which is accepted as well as it
 * can be. Nothing here writes: every card is a proposal, except that music
 * asked to play plays and the music playing is controlled, on the device.
 */

/** Rounds of tool calls before it must answer. */
const ROUNDS = 4
/** Time from the first request after which it answers with what it has. */
const BUDGET_MS = 60_000
/** One round's longest wait: a round writes a plan of calls, never a long answer. */
const ROUND_MS = 60_000

const SYSTEM = `You are the request box of someone's own music app. They write one request, in any language; you answer it with their own library by calling tools, and finish by calling respond, which shows them cards. You never write to their library: every card is a proposal they accept with one press, except that music they ask to play starts playing and the music already playing is controlled at once.

The rules:
- Only their own songs. Every song you show comes from a tool's result or a set; never name a song of theirs you have not seen. Music they do not have is only talked about (a words card) or offered to get (getMusic).
- It proposes, they approve. Tags, names, copies and playlists change only through the proposal cards.
- Answers are cards, chosen from the kinds below; say is a few words above them.

Sets. Songs live in named sets. The request comes with some already: playing is the song playing on their device; each earlier answer that showed songs is a set named by its handle (t2.1 is the second turn's first card), its songs numbered as listed; screen is the answer on their screen now. A tool that finds or chooses songs keeps them under the name you give in as. Every argument that takes songs is a scope: set, then pick (places in its list, 1 for the first) or drop (places to leave out), or ids a result showed you, and filters over them. When their words point at songs rather than describe them, they mean the screen's songs, or the song playing when they speak of what is playing. When their words point at one song of a list that was offered as candidates or ordered best first, it is the first.

Planning. Each round costs seconds, so put every call you can foresee in one reply, in order: a later call may use a set an earlier one in the same reply makes. End that same reply with respond whenever you do not need to see the results first. Make another round only when you must see a result: to learn how the library spells a name, whether anything was found, or a number to tell them. A result that comes to nothing says which condition left none (emptiedBy) and which names the library lacks with the nearest it has (unmatched): look again with those before saying it isn't there. Never loosen what they asked for without saying so.

Choosing songs:
- What can be said as conditions (artists, albums, tags, years, plays, when added or played, lyrics or not, a playlist's songs) goes to find_songs. Names go as they wrote them; the library matches spellings, scripts and other names.
- Songs in an order the library knows (most played, newest, longest) are find_songs with sort and limit: exact, nothing picked. An album in its own order: album_tracks lists its tracks in order with the ids of theirs, which a card can show in that order.
- A mood, an occasion, an activity, a sound, or a quality only listening or knowing the music can tell goes to pick_by_taste, with brief (what every song must be or is for) and sound (how it should sound, in English). Narrow the scope first with conditions when the request names places. Energy is a measure of loudness, not mood: give a range only when they ask for a level of loudness or energy outright.
- Music relative to a song (like it, calmer or livelier than it, more of it) is chosen among songs of its kind (its tags, its language, its artist's scene) unless they ask to leave that kind, with like naming the song.
- One particular song they half remember (its words, its story, how it goes) is find_half_remembered, answered with a find card of its candidates.
- A count or a list of songs by meaning is judge_each, which reads every song; pick_by_taste chooses a number of the best.
- A change to a list shown (more or fewer, longer, without some, a different feel) is a new songs card: songs left out by drop; otherwise chosen again with pick_by_taste from the scope the list was made from, keep naming the list so the songs that still fit stay in their places. A change that keeps only some kind of song, or lets more in, chooses from what the list was made from, not only from the songs shown. It keeps what the list was for.
- Music to play one kind after another is one songs card whose from names their sets in order (sets).
- How many: a number they say is count, a length is minutes, never one turned into the other. With neither, choose a sensible handful.

Cards (respond's cards, 1 to 4, in the order the request asks for its parts; several parts about the same songs act on the same set):
- songs: from, lead (play: they want it now; save: they want it kept as a playlist, title its name; next: after the song playing), title.
- find: from, the set find_half_remembered made: songs they half remember.
- library: a question about what is in the library, counted in code: from (none for the whole library), show (count, songs, artists, albums, tags), sort, order, limit.
- stats: their listening: range (7d, 30d, 90d, 365d, all), about (songs, artists, tags, totals), limit.
- tags, tidy, copies: proposal, the as of the propose call that made it.
- playlist: op delete or rename (playlists, newName); create (newName, from); add or remove (playlists with one name, from: the songs); sort (playlists, sort, order). A live playlist fills itself from its rules; its card says so.
- playback: op next, previous, restart, pause, resume, or upNext with at (1 the first in Up next, -1 the last).
- remember: text, a standing preference as one short rule in their language, when they say how things should be done from now on.
- open: place (import, stats, tags, library, playlists, settings) and text, when they want to go somewhere in the app.
- getMusic: text (what to search 网易云 for, as the album or song is listed) and album, when they ask to get music they don't have.
- together: from (or none), for listening with friends in a room.
- words: text, an answer in words, with from for the songs it is about and get for one song or album they don't have; for questions about music itself, answer from what you know as well as what you look up, and say when it is from memory.
- clarify: question and up to three options in their words, alone. Ask back only when the readings of their words would give materially different answers and no lookup can tell which; otherwise act on the likeliest reading and say the assumption in say.
Each card may carry note (why it is empty or short) and expect: what the request requires of its songs (count, minutes, artists, script of their names, order). respond checks expect against the songs in code and tells you what does not hold; mend it, or answer with what there is and say what is short in note.

When they ask for something this box cannot do but the app can, say where in the app it is done, and offer nothing in its place that they did not ask for.

say: at most three short sentences in the language of their newest words, or nothing when the cards say it all. Every number in it must come from a tool's result. Never say you did something that is only proposed.`

const WEB = `

You may also search the web, for what neither their library nor the catalogue says. Say where an answer came from when it came from the web.`

/**
 * The request as the agent reads it: what they say now, after the
 * conversation so far. Each earlier turn comes with what was shown for it, so
 * it is context and not asked again. What the answers showed is set out by
 * handle, the one on their screen first, each with its songs numbered
 * (`objectLines`), so a follow-up names them by handle and place.
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
      ? `On their screen now: ${onScreen.handle} (the set screen).`
      : 'Nothing from this conversation is on their screen now.',
    '',
    `Now they say: ${text}`,
    '(Answer what they say now. The earlier turns are what it follows on from, not questions to answer again; when it changes something asked before, the answer is that earlier request changed. Write for them in the language of what they say now.)',
  ].join('\n')
}

/** The request with their standing preferences after it, when they have any. */
export function withNotes(request: string, notes: readonly string[]): string {
  if (notes.length === 0) return request
  return `${request}\n\nTheir standing preferences (follow them unless these words say otherwise):\n${notes.map(note => `- ${note}`).join('\n')}`
}

/** The agent's `respond`: the reply built and checked, one bounce, then accepted. */
function respondTool(
  context: Responding,
  answered: { reply: AskReply | null; bounces: number },
): LlmTool {
  return tool({
    name: 'respond',
    description: `Answer them: say and the cards (${CARD_KINDS.join(', ')}), as the instructions describe. Call it last; nothing after it runs. When a check fails, its error says what, once; mend it or answer with what there is.`,
    parameters: RespondArgs,
    ends: true,
    run: async args => {
      try {
        answered.reply = await respond(context, args, answered.bounces > 0)
      } catch (caught) {
        if (caught instanceof RespondProblems) answered.bounces++
        throw caught
      }
    },
  })
}

/** How hard the brain thinks: measured on the eval set (docs/features/ai.md, S1). */
const EFFORT =
  (process.env['SELFMP3_AI_AGENT_EFFORT'] as 'low' | 'medium' | 'high' | undefined) || undefined

export async function ask(
  deps: AskDeps,
  text: string,
  /** The song playing on the device and the answer on its screen. */
  where: AskRequest['context'] = { playing: null, screen: null },
  /** Told each stage as it begins, for the device's waiting steps (`progress.ts`). */
  steps: Steps = NO_STEPS,
  /** The conversation before this, when it follows up on an answer. */
  before: readonly AskTurn[] = [],
): Promise<AskReply> {
  const remembered = deps.remembered ?? new Remembered()
  const all = { ...deps, remembered }
  const library = libraryOf(deps)
  const byId = new Map(library.songs.map(song => [song.id, song]))
  const playing = where.playing === null ? undefined : byId.get(where.playing)
  const held: Held = {
    playing,
    objects: before.flatMap(turn => turn.objects),
    screen: where.screen,
  }
  const set = new WorkingSet(library, held)
  const playlists = deps.playlists?.() ?? []
  const web = deps.web?.() ?? false

  const playlistLines = playlists.map(
    playlist =>
      `- “${playlist.name}”: ${playlist.kind === 'live' && playlist.rules ? `live, holds ${rulesWords(playlist.rules, library.tags)}` : `manual, ${playlist.songIds().length} songs`}`,
  )
  const nowPlaying = playing
    ? `Now playing (the set playing): ${songTable([playing], library.tags, library.now).replace(/^#1 \| /, '')}`
    : 'Nothing is playing.'
  const sets = set.listing()
  const request = withNotes(followed(text, before, where.screen, byId), deps.notes?.() ?? [])
  const prompt = [
    libraryShape(library.songs, library.tags, library.names),
    '',
    `Their tags, exactly: ${library.tags.map(tag => tag.name).join(', ') || '(none)'}`,
    '',
    `Their playlists:\n${playlistLines.join('\n') || '(none)'}`,
    '',
    nowPlaying,
    '',
    sets.length > 0 ? `Sets already named:\n${sets.join('\n')}` : 'No set is named yet.',
    '',
    `The request:\n${request}`,
  ].join('\n')

  // What the model was shown, where every number it says must come from.
  const shown: string[] = [prompt]
  let read = false
  const reading = (): void => {
    if (!read) steps.done('Read what you asked')
    read = true
  }
  const tools = askTools(all, set, { question: request, steps }).map(each => ({
    ...each,
    run: async (args: never) => {
      reading()
      const result = await each.run(args)
      shown.push(JSON.stringify(result))
      return result
    },
  }))
  const context: Responding = {
    deps: all,
    set,
    words: text,
    playing,
    playlists,
    seen: () => shown.join('\n'),
    steps,
  }
  const answered = { reply: null as AskReply | null, bounces: 0 }
  steps.begin('Reading what you asked')
  // Not remembered: asked again, the same words are read again, so Try again can come out differently.
  const { value } = await deps.llm.generate({
    task: 'ask-agent',
    tier: 'smart',
    json: 'text',
    ...(EFFORT ? { effort: EFFORT } : {}),
    system: web ? SYSTEM + WEB : SYSTEM,
    prompt,
    schema: RespondArgs,
    tools: [...tools, respondTool(context, answered)],
    maxRounds: ROUNDS,
    budgetMs: BUDGET_MS,
    timeoutMs: ROUND_MS,
    webSearch: web,
  })
  reading()
  // Answered in words once the tools were gone: taken as well as it can be.
  return answered.reply ?? (await respond(context, value, true))
}
