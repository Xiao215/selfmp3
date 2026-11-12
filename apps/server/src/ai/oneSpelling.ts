import { z } from 'zod/v4'
import {
  artistKey,
  namesFor,
  NO_JOINS,
  plural,
  splitArtists,
  withoutRepeats,
  type ArtistJoinNames,
  type Song,
  type TidyChange,
  type TidyResult,
} from '@selfmp3/shared'
import { pool } from '../util/pool.js'
import { CALLS_AT_ONCE, inTheirLanguage } from './askedTidy.js'
import { LlmError, llmFailureWords, Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { chunks, foldedBare as bare } from './text.js'
import { grouped, TIDY_VERSION, type Edit, type TidyAsked, type TidyDeps } from './tidy.js'

/**
 * Tidy up, asked to make one artist's names one ("the artists in there twice
 * under different names"; docs/features/ai.md, A4). Batches of songs cannot
 * do it (askedTidy.ts): the two names are seldom in one batch. Code groups
 * the library's artist names that may be one artist first — the same
 * letters, the same spelling in Latin letters (ヨルシカ and Yorushika), one
 * listed among the other's other names — and the model is shown those groups
 * alone, once.
 */

/** One artist's names as the model reads them: each with the songs that carry it. */
interface NameGroup {
  readonly names: readonly { readonly name: string; readonly songs: readonly Song[] }[]
}

/**
 * The library's artist names that may be one artist, as groups of two or
 * more, biggest first: names with the same letters once case, marks and
 * spacing are set aside; a Chinese or Japanese name and a Latin one its
 * spelling matches (ヨルシカ, "yorushika"); and a name listed among another's
 * other names, saved or found. Code only gathers: whether they are one artist
 * is the model's to say.
 */
export function nameGroups(
  songs: readonly Song[],
  joins: ArtistJoinNames = NO_JOINS,
  spellings: ReadonlyMap<string, readonly string[]> = new Map(),
): NameGroup[] {
  const byName = new Map<string, Song[]>()
  for (const song of songs) {
    for (const name of splitArtists(song.artist, 'list')) {
      const list = byName.get(name)
      if (list) list.push(song)
      else byName.set(name, [song])
    }
  }
  // The keys a name is found by: its letters, and each of its spellings run together.
  const keysOf = (name: string): string[] =>
    [name, ...(spellings.get(name) ?? [])].map(bare).filter(key => key.length > 1)

  const names = [...byName.keys()]
  const root = names.map((_, index) => index)
  const find = (index: number): number => {
    while (root[index] !== index) index = root[index] = root[root[index]!]!
    return index
  }
  const union = (a: number, b: number): void => {
    const [x, y] = [find(a), find(b)]
    if (x !== y) root[Math.max(x, y)] = Math.min(x, y)
  }
  const first = new Map<string, number>()
  names.forEach((name, index) => {
    for (const key of keysOf(name)) {
      const other = first.get(key)
      if (other === undefined) first.set(key, index)
      else union(other, index)
    }
  })
  // Other names join only names the library has: each is found by its own keys.
  names.forEach((name, index) => {
    for (const other of namesFor(joins.artistNames, artistKey(name))) {
      for (const key of keysOf(other)) {
        const at = first.get(key)
        if (at !== undefined) union(at, index)
      }
    }
  })

  const groups = new Map<number, string[]>()
  names.forEach((name, index) => {
    const at = find(index)
    groups.set(at, [...(groups.get(at) ?? []), name])
  })
  const size = (group: NameGroup): number =>
    group.names.reduce((n, each) => n + each.songs.length, 0)
  return [...groups.values()]
    .filter(group => group.length > 1)
    .map(group => ({
      names: group
        .map(name => ({ name, songs: byName.get(name)! }))
        .sort((a, b) => b.songs.length - a.songs.length || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => size(b) - size(a))
}

/** Name groups per model call: a group is about 60 tokens in. */
const NAME_GROUPS_PER_CALL = 80
/** The most name groups one request looks at; past that, the biggest. */
const MAX_NAME_GROUPS = 400

const OneOut = z.object({
  groups: z
    .array(
      z.object({
        g: z.number().int(),
        keep: z.string().max(200),
        from: z.array(z.string().max(200)).max(10),
        why: z.string().max(120),
      }),
    )
    .max(NAME_GROUPS_PER_CALL),
  say: z.string().max(300),
})

const ONE_SYSTEM = `You make each artist's name one name across someone's own music library, the way they ask. You are given their request and numbered groups of artist names from the library that may be one artist written more than one way (in another script, romanised, translated, spelt differently, or saved as one another's other name), each with how many songs carry it and a few of those songs. Reply with JSON only: groups and say.

- groups: one entry for each group that holds one artist under more than one name. g is the group's number; keep is the name to keep, copied exactly; from are the names to replace with it, copied exactly; why is at most six plain words. Keep the name the request asks for; when it does not say, the artist's own name in its own script over a romanisation or translation, and otherwise the name more songs carry.
- Leave out a group whose names are different artists, or that you are not sure of; when a group holds more than one artist, list only the names that are one. Never use a number or a name that is not shown.
- say: what you tell them, in one or two plain sentences, in the language they wrote their request in (not the language of the names). Empty when the changes say it all.`

/** The request to make each artist's names one, over the songs it is about. */
export async function oneSpelling(
  deps: TidyDeps,
  asked: TidyAsked,
  steps: Steps = NO_STEPS,
): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  const notes: string[] = []
  if (asked.unknown.length > 0) notes.push(`Your library has no ${asked.unknown.join(' or ')}.`)
  const library = deps.songs()
  const chosen = new Set(asked.songs.map(song => song.id))
  steps.begin(`Reading the artist names of ${plural(library.length, 'song', 'songs')}`)
  // Across the whole library: the other spelling is seldom among the songs asked about.
  const found = nameGroups(library, deps.artistNames?.(), deps.spellings?.()).filter(group =>
    group.names.some(each => each.songs.some(song => chosen.has(song.id))),
  )
  const groups = found.slice(0, MAX_NAME_GROUPS)
  if (found.length > groups.length) {
    notes.push(
      `Looked at the biggest ${groups.length} of ${found.length} names; ask again for the rest.`,
    )
  }
  steps.done(
    groups.length === 0
      ? 'No name looks like another'
      : `${plural(groups.length, 'name', 'names')} may be one artist`,
  )
  const result = (changes: TidyChange[], reply: string | null): TidyResult => ({
    changes,
    looked: asked.songs.length,
    note: notes.length > 0 ? notes.join(' ') : null,
    asked: asked.text,
    reply: inTheirLanguage(asked.text, reply),
    gaps: null,
  })
  if (groups.length === 0) return result([], null)

  steps.begin(`Reading ${plural(groups.length, 'name', 'names')} that may be one artist`)
  const line = (group: NameGroup, g: number): string =>
    `${g} | ${group.names
      .map(
        ({ name, songs }) =>
          `${name} (${songs.length}): ${songs
            .slice(0, 2)
            .map(song => `${song.title}${song.album ? ` · ${song.album}` : ''}`)
            .join('; ')}`,
      )
      .join(' | ')}`
  // The name each name becomes, and why.
  const respelled = new Map<string, { to: string; why: string }>()
  const said: string[] = []
  const failures: LlmError[] = []
  const calls = chunks(groups, NAME_GROUPS_PER_CALL)
  await pool(calls, CALLS_AT_ONCE, async call => {
    const prompt = `The request:\n${asked.text}\n\nNames that may be one artist (g | name (songs): a few of them | …):\n${call.map((group, at) => line(group, at + 1)).join('\n')}`
    try {
      const answer = await remembered.get(
        Remembered.key('tidy-one', TIDY_VERSION, prompt),
        async () =>
          (
            await deps.llm.generate({
              task: 'tidy-one',
              tier: 'smart',
              system: ONE_SYSTEM,
              prompt,
              schema: OneOut,
            })
          ).value,
      )
      if (answer.say.trim()) said.push(answer.say.trim())
      // The check: a group shown, names of that group, each name answered once,
      // and a name kept never itself replaced, so no song goes round in a circle.
      const kept = new Set([...respelled.values()].map(each => each.to))
      for (const entry of answer.groups) {
        const group = call[entry.g - 1]
        const shown = new Set(group?.names.map(each => each.name))
        const keep = entry.keep.trim()
        if (!shown.has(keep) || respelled.has(keep)) continue
        for (const name of entry.from) {
          if (name === keep || !shown.has(name) || respelled.has(name) || kept.has(name)) continue
          respelled.set(name, { to: keep, why: entry.why.trim() || 'Same artist, one name' })
          kept.add(keep)
        }
      }
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      failures.push(caught)
    }
  })
  const [failure] = failures
  if (failure && failures.length === calls.length) throw failure
  if (failure) {
    notes.push(`${llmFailureWords[failure.kind]} Some names were left out; ask again for them.`)
  }

  const { propose, changes } = grouped()
  const respell = (credit: string): Edit => {
    const names = splitArtists(credit, 'list')
    const changed = names.filter(name => respelled.has(name))
    if (changed.length === 0) return { value: credit, whys: [] }
    return {
      value: withoutRepeats(names.map(name => respelled.get(name)?.to ?? name).join(', ')),
      whys: [...new Set(changed.map(name => respelled.get(name)!.why))],
    }
  }
  for (const song of asked.songs) {
    propose(song, 'artist', song.artist, respell(song.artist), 'model')
    if (song.albumArtist) {
      propose(song, 'albumArtist', song.albumArtist, respell(song.albumArtist), 'model')
    }
  }
  const proposed = changes()
  steps.done(`${proposed.length} ${proposed.length === 1 ? 'change' : 'changes'}`)
  return result(proposed, said[0] ?? null)
}
