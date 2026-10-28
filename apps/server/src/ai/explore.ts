import { z } from 'zod/v4'
import type { AskAnswer } from '@selfmp3/shared'
import type { AskDeps } from './askActions.js'
import { askTools, libraryOf, type AskToolName } from './askTools.js'
import { libraryShape } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import type { Held } from './scope.js'
import { WorkingSet } from './workingSet.js'

/**
 * Ask's open questions (docs/features/ai.md, "Looking things up"): what the
 * fixed actions cannot say with filters — which albums they have only part
 * of, what a piece is called in another language, whether they have
 * something — and questions about music itself, a song or artist they may
 * not have, answered from what the model knows too. The model is given the
 * library's shape and Ask's tools (`askTools.ts`) over this request's working
 * set (`workingSet.ts`): the song playing and what earlier answers showed are
 * sets it can name, and every song it finds becomes one. The endpoint
 * searches the web itself. It answers in a few sentences and the songs it is
 * about, and every song it names is checked to be one it was shown.
 *
 * Only the tools that look: proposals are other answers' to make.
 */

const VERSION = 5
/** Rounds of looking before it must answer. */
const ROUNDS = 6
/** Time to look, after which it answers with what it has. */
const BUDGET_MS = 120_000
/** One round's longest wait. */
const ROUND_MS = 90_000
const MAX_SONGS = 50

/** The tools explore offers: every one that looks, none that proposes. */
const LOOKING: readonly AskToolName[] = [
  'find_songs',
  'count_by',
  'listening',
  'lookup_names',
  'pick_by_taste',
  'find_half_remembered',
  'album_tracks',
  'catalogue',
]

const Out = z.object({
  say: z.string().max(1200),
  songs: z.array(z.number().int()).max(MAX_SONGS),
  set: z.string().max(24).nullable().default(null),
  get: z.string().max(120).nullable(),
})

const SYSTEM = `You answer someone's questions about music, in the language they write in: about their own library, and about music itself — a song, an artist, an album, who sang it. You have tools to look through their library, their listening and 网易云, a music catalogue with publishers' own names (Chinese, Japanese and English), albums and track lists. Never say what is or isn't in the library without looking.

Songs live in named sets. A tool that finds songs keeps them under the name you give in "as"; a tool that takes songs takes a scope: a set's name, places in its list (1 for the first), ids a result showed you, and filters over them. The sets the request came with are listed with it: "playing" is the song playing, an earlier answer's handle holds what it showed, and "screen" is the answer on their screen. You may make several calls in one reply; they run in the order written, so a later call can use a set an earlier one in the same reply makes. Plan the calls a question needs and make them together when one does not need to see another's result first.

When a search comes to nothing, its result says which condition left no songs (emptiedBy) and which names the library does not have, with the names it has nearest them (unmatched): look again with those, another spelling, another script or part of the name, before you conclude. A count you report must come from a tool's result.

About music itself, answer from what you know as well as from what you look up, and tell them what you know even when it isn't in their library or the catalogue. Say so when an answer is from memory and could be out of date. When the question is about a song or an artist, say whether they have it.

Reply with JSON only:
- say: the answer, plain and short, at most five sentences. Name songs, albums and artists as they are written. When you could not find out, say so.
- songs: ids of their songs the answer is about, from tool results, best first, at most ${MAX_SONGS}; empty when none.
- set: the name of a set whose songs the answer is about, instead of or before listing ids; otherwise null.
- get: when the answer is about one song or album they don't have, its name and artist as a music catalogue would list them, to search for it; otherwise null.`

const WEB = `

You may also search the web, for what neither their library nor the catalogue says. Say where an answer came from when it came from the web.`

const NOTHING_HELD: Held = { playing: undefined, objects: [] }

export async function explore(
  deps: AskDeps,
  text: string,
  steps: Steps = NO_STEPS,
  /** The song playing and what earlier answers showed: the sets it starts with. */
  held: Held = NOTHING_HELD,
): Promise<Extract<AskAnswer, { kind: 'explore' }>> {
  const remembered = deps.remembered ?? new Remembered()
  const library = libraryOf(deps)
  const set = new WorkingSet(library, held)
  const web = deps.web?.() ?? false
  const sets = set.listing()
  const prompt = [
    libraryShape(library.songs, library.tags, library.names),
    '',
    sets.length > 0 ? `Sets already named:\n${sets.join('\n')}` : 'No set is named yet.',
    '',
    `The question:\n${text}`,
  ].join('\n')
  steps.begin('Looking into it')
  // The answer is kept grounded: the sets it names exist only while it is asked.
  const answer = await remembered.get(
    Remembered.key('ask-explore', VERSION, web, prompt),
    async () => {
      const { value } = await deps.llm.generate({
        task: 'ask-explore',
        tier: 'smart',
        system: web ? SYSTEM + WEB : SYSTEM,
        prompt,
        schema: Out,
        tools: askTools({ ...deps, remembered }, set, { question: text, only: LOOKING, steps }),
        maxRounds: ROUNDS,
        json: 'text',
        timeoutMs: ROUND_MS,
        budgetMs: BUDGET_MS,
        webSearch: web,
      })
      // Only songs it was shown or a set holds, its set's first, once each.
      const named =
        value.set && set.has(value.set) ? set.songsOf(value.set).map(song => song.id) : []
      const songIds = [...new Set([...named, ...value.songs])]
        .filter(id => set.allowed(id))
        .slice(0, MAX_SONGS)
      return { say: value.say.trim(), songIds, get: value.get?.trim() || null }
    },
  )
  steps.done()
  return { kind: 'explore', ...answer }
}
