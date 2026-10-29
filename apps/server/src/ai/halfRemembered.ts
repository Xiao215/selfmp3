import type { DescribePick, Song } from '@selfmp3/shared'
import { PickOut, groundPicks, type DescribeDeps } from './describe.js'
import { songTable } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'

/**
 * A song they half remember (docs/features/ai.md, "find"): the songs whose
 * names or lyrics hold any of a few words, in code, then a model chooses the
 * few that could be the one they mean. Ask's `find` answers with them, and
 * Ask's tools look with it (`find_half_remembered`).
 */

/** The most songs a "find" is chosen from. */
const MAX_FOUND = 150
const FIND_SIZE = 5
const FIND_VERSION = 1

type Lyrics = (query: string) => { songId: number; line: string }[]

/** Songs whose title, artist or album holds a term, then ones whose lyrics do, once each. */
export function songsMatching(
  terms: readonly string[],
  songs: readonly Song[],
  lyrics: Lyrics,
): { song: Song; line: string | null }[] {
  const wanted = terms.map(term => term.trim().toLowerCase()).filter(Boolean)
  const found = new Map<number, { song: Song; line: string | null }>()
  for (const song of songs) {
    const text = `${song.title} ${song.artist} ${song.album}`.toLowerCase()
    if (wanted.some(term => text.includes(term))) found.set(song.id, { song, line: null })
  }
  const byId = new Map(songs.map(song => [song.id, song]))
  for (const term of wanted) {
    for (const hit of lyrics(term)) {
      const song = byId.get(hit.songId)
      if (song && (found.get(song.id)?.line ?? null) === null) {
        found.set(song.id, { song, line: hit.line })
      }
    }
  }
  return [...found.values()].slice(0, MAX_FOUND)
}

const FIND_SYSTEM = `Someone is looking for one song in their own library that they half remember. You are given what they remember and a numbered table of candidate songs (with a lyric line where one matched). Reply with JSON only: picks, at most ${FIND_SIZE}, best first, each the song's number (n) and why it fits in at most ten plain words. Only choose songs that plausibly are the one they mean; if none are, return no picks. Never use a number that is not in the table.`

/**
 * The songs that could be the one they mean, best first, and how many matched
 * the words before the model chose: when none matched, no model is asked.
 */
export async function halfRemembered(
  deps: DescribeDeps & { readonly lyrics: Lyrics },
  asked: {
    readonly text: string
    readonly terms: readonly string[]
    readonly brief: string
    readonly now: number
  },
  steps: Steps = NO_STEPS,
): Promise<{ found: number; picks: DescribePick[] }> {
  const remembered = deps.remembered ?? new Remembered()
  const quoted = asked.terms
    .slice(0, 3)
    .map(term => `“${term}”`)
    .join(', ')
  steps.begin(`Looking for ${quoted} in titles and lyrics`)
  const found = songsMatching(asked.terms, deps.songs(), deps.lyrics)
  steps.done(found.length === 0 ? 'None of yours matched' : `${found.length} could be it`)
  if (found.length === 0) return { found: 0, picks: [] }
  steps.begin('Choosing the one you mean')
  const table = found.map(each => each.song)
  const lines = songTable(table, deps.tags(), asked.now)
    .split('\n')
    .map((line, index) => (found[index]!.line ? `${line} | lyric: ${found[index]!.line}` : line))
  const prompt = `What they remember: ${asked.brief}\nTheir words: ${asked.text}\n\nThe table (number | title | artist | album | year | tags | energy | tempo | length | words | plays | lyric):\n${lines.join('\n')}`
  const answer = await remembered.get(
    Remembered.key('ask-find', FIND_VERSION, prompt),
    async () =>
      (
        await deps.llm.generate({
          task: 'ask-find',
          tier: 'smart',
          system: FIND_SYSTEM,
          prompt,
          schema: PickOut,
        })
      ).value,
  )
  steps.done()
  return { found: found.length, picks: groundPicks(answer.picks, table, FIND_SIZE) }
}
