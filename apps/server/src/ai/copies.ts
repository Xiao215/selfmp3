import { z } from 'zod/v4'
import {
  artistKey,
  formatDuration,
  namesFor,
  NO_JOINS,
  plural,
  splitArtists,
  withoutTranslation,
  type ArtistJoinNames,
  type CopiesResult,
  type Song,
  type TidyCopy,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'
import { chunks, foldedBare as bare, pool } from './text.js'
import { withoutVideoWords } from './tidy.js'

/**
 * A4 · Copies (docs/features/ai.md): songs that are in the library more than
 * once, each extra copy offered for deleting. Nothing here writes.
 *
 * Code finds the songs that might be one recording: the same title once a
 * video's words ("(Official Music Video)") and an English translation after
 * it ("恋風 - Koikaze") are set aside, an artist in common — or two names one
 * artist goes by (Lilas, 幾田りら) — and about the same length; or, between songs the listening model
 * has heard, the same length and the same sound whatever they are called. A
 * title with words the other lacks — "(Live)", "(Bayan)", "(II)" — is
 * another version until the sound says otherwise: shown "Liyue" and "Liyue
 * (Bayan)" on one album and nothing else, the model called them copies
 * (tried 2026-10-14). Either way only songs on one
 * album, or with none, or a single and the album that took it in (within
 * 2 s): one recording kept on two albums — a theme on two soundtracks, a
 * song and its best-of — is kept on purpose, and the model, shown two that
 * sound the same, called them copies (tried 2026-10-14), so that is a rule
 * in code. A single is an album named as its song: released alone first,
 * then on the album, it is the same release twice rather than a choice. Many of the rest are not copies either — a live
 * take, an arrangement, a second part — and code cannot tell those apart, so
 * the model is shown each group with everything known about its songs and
 * says which of them are one recording. Only songs with nothing between them
 * — the same names, album and length — are counted without it.
 *
 * Which copy stays is code's: the one with the most plays, then loved, then
 * the most tags, then the bigger file, then the first added, so deleting the
 * others loses as little as can be.
 */

const VERSION = 2

/** How far apart in seconds two songs may be and still be one recording. */
const SAME_LENGTH_S = 3
/** A single and an album's song: as long as each other within this. */
const SINGLE_LENGTH_S = 2
/** For songs named differently: as long as each other to the second. */
const SOUND_LENGTH_S = 1
/** How close two songs must sound, 0–1, to be looked at though their names differ. */
const SOUND_SAME = 0.97
/** The most groups the model is shown in one request. */
const MAX_GROUPS = 120
const GROUPS_PER_CALL = 30

/** The listening model's one question here: how close each song sounds to one song. */
interface SoundCloseness {
  closeTo(seedId: number, songIds: readonly number[]): Map<number, number> | null
}

interface CopiesDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly sound?: SoundCloseness
  /** Artists' other names: two names one artist goes by meet as one. */
  readonly artistNames?: () => ArtistJoinNames
  readonly remembered?: Remembered
}

const CopiesOut = z.object({
  groups: z
    .array(
      z.object({
        g: z.number().int(),
        /** Sets of song numbers, each set one recording in the library more than once. */
        same: z.array(z.array(z.number().int()).max(20)).max(10),
        why: z.string().max(120),
      }),
    )
    .max(GROUPS_PER_CALL),
})

const COPIES_SYSTEM = `You find songs someone has in their own music library more than once. You are given groups of their songs that share a name or sound alike and are about as long as each other, each song numbered within its group, with its title, artist, album, year, length, file, when it was added and how often it was played, and, where a listening model has heard both, how close it sounds to the group's first song (0–100). Reply with JSON only: groups, each a group's number (g), same: the sets of song numbers in it that are one recording held more than once, and why in at most eight plain words.

- A copy is extra only when deleting it loses nothing the person would miss: the same recording under names that differ at most in how they are written. Songs that are different recordings, versions or parts of a piece are songs in their own right however alike their names and lengths, and so is a song kept on purpose on more than one release. Judge each group from what the table says and what you know of the music.
- Leave a group out when its songs are not copies, or when you are not sure. Never use a number that is not shown.`

/** A title as it is compared: a video's words and a translation after it set aside, letters and digits only. */
export function titleKey(title: string): string {
  return bare(withoutTranslation(withoutVideoWords(title)))
}

/**
 * Whether two credits have a name in common, or one of them names nobody. A
 * name stands for the other names it goes by too, saved or found.
 */
function artistsMeet(a: Song, b: Song, joins: ArtistJoinNames): boolean {
  const names = (song: Song): string[] =>
    splitArtists(song.artist).flatMap(name => [
      bare(name),
      ...namesFor(joins.artistNames, artistKey(name)).map(bare),
    ])
  const left = names(a).filter(Boolean)
  const right = new Set(names(b).filter(Boolean))
  return left.length === 0 || right.size === 0 || left.some(name => right.has(name))
}

const closeLength = (a: Song, b: Song, seconds: number): boolean =>
  a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) <= seconds

/** Whether a song's album is its single: an album named as the song itself. */
const onSingle = (song: Song): boolean =>
  song.album !== '' && titleKey(song.album) === titleKey(song.title)

/** The albums named among some songs, each once; a song with none, or on its single, names none. */
const albumsOf = (songs: readonly Song[]): Set<string> =>
  new Set(songs.flatMap(song => (onSingle(song) ? [] : [bare(song.album)])).filter(Boolean))

/**
 * Whether two songs could be one copy and another: on one album, or one of
 * them on none, or one on its single and as long as the other within 2 s.
 */
const oneAlbum = (a: Song, b: Song): boolean =>
  new Set([a, b].map(song => bare(song.album)).filter(Boolean)).size < 2 ||
  (albumsOf([a, b]).size < 2 && closeLength(a, b, SINGLE_LENGTH_S))

/**
 * The songs that might be one recording, as groups: by name and length, and
 * by sound and length. A group has at least two songs and at least one of
 * `among` (the songs asked about).
 */
export function candidateGroups(
  songs: readonly Song[],
  among: ReadonlySet<number>,
  sound?: SoundCloseness,
  joins: ArtistJoinNames = NO_JOINS,
): { groups: Song[][]; closeness: Map<string, number> } {
  // Songs joined into groups, each pointing towards its group's first.
  const parent = new Map<number, number>()
  const joined = new Set<number>()
  const find = (id: number): number => {
    let root = id
    while (parent.has(root)) root = parent.get(root)!
    return root
  }
  const join = (a: number, b: number): void => {
    joined.add(a).add(b)
    const x = find(a)
    const y = find(b)
    if (x !== y) parent.set(Math.max(x, y), Math.min(x, y))
  }

  // By name: one title, an artist in common, about one length. A title with a
  // word more is another version, which only the sound can say is not.
  const byTitle = new Map<string, Song[]>()
  for (const song of songs) {
    const key = titleKey(song.title)
    if (!key) continue
    byTitle.set(key, [...(byTitle.get(key) ?? []), song])
  }
  for (const same of byTitle.values()) {
    for (let i = 0; i < same.length; i++) {
      for (let j = i + 1; j < same.length; j++) {
        const a = same[i]!
        const b = same[j]!
        if (artistsMeet(a, b, joins) && oneAlbum(a, b) && closeLength(a, b, SAME_LENGTH_S)) {
          join(a.id, b.id)
        }
      }
    }
  }

  // By sound: as long as each other to the second, and sounding the same.
  const closeness = new Map<string, number>()
  if (sound) {
    const byId = new Map(songs.map(song => [song.id, song]))
    const sorted = songs.filter(song => song.duration > 0).sort((a, b) => a.duration - b.duration)
    for (let i = 0; i < sorted.length; i++) {
      const seed = sorted[i]!
      const near: number[] = []
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j]!.duration - seed.duration > SOUND_LENGTH_S) break
        near.push(sorted[j]!.id)
      }
      if (near.length === 0) continue
      const close = sound.closeTo(seed.id, near)
      for (const [id, score] of close ?? []) {
        closeness.set(pairKey(seed.id, id), score)
        if (score >= SOUND_SAME && oneAlbum(seed, byId.get(id)!)) join(seed.id, id)
      }
    }
  }

  const groups = new Map<number, Song[]>()
  for (const song of songs) {
    if (!joined.has(song.id)) continue
    const root = find(song.id)
    groups.set(root, [...(groups.get(root) ?? []), song])
  }
  return {
    groups: [...groups.values()]
      .filter(group => group.length > 1 && group.some(song => among.has(song.id)))
      .map(group => group.sort((a, b) => a.id - b.id)),
    closeness,
  }
}

const pairKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`

/** Songs with nothing between them: the same names, the same album, the same length to the second. */
function exactly(group: readonly Song[]): boolean {
  const [first, ...rest] = group
  const same = (song: Song): boolean =>
    bare(song.title) === bare(first!.title) &&
    bare(song.artist) === bare(first!.artist) &&
    bare(song.album) === bare(first!.album) &&
    closeLength(song, first!, SOUND_LENGTH_S)
  return rest.every(same)
}

/** Which copy stays: the one deleting the others loses least from. */
export function keeper(copies: readonly Song[]): Song {
  return [...copies].sort(
    (a, b) =>
      b.playCount - a.playCount ||
      Number(b.loved) - Number(a.loved) ||
      b.tagIds.length - a.tagIds.length ||
      b.sizeBytes - a.sizeBytes ||
      a.addedAt.localeCompare(b.addedAt) ||
      a.id - b.id,
  )[0]!
}

function copyOf(songs: readonly Song[], why: string, by: TidyCopy['by']): TidyCopy {
  const keep = keeper(songs)
  const songIds = songs.filter(song => song.id !== keep.id).map(song => song.id)
  return {
    key: Remembered.key('copy', keep.id, songIds).slice(0, 16),
    keep: keep.id,
    songIds,
    why,
    by,
  }
}

/** A group as the model reads it. */
function groupLines(
  group: readonly Song[],
  g: number,
  closeness: ReadonlyMap<string, number>,
): string {
  const [first] = group
  return [
    `Group ${g}`,
    ...group.map((song, index) => {
      const close = index === 0 ? undefined : closeness.get(pairKey(first!.id, song.id))
      return [
        ` ${index + 1}`,
        song.title,
        song.artist || '-',
        song.album || '-',
        song.year ?? '-',
        formatDuration(song.duration),
        `${song.path.split('.').pop() ?? '-'} ${(song.sizeBytes / 1_000_000).toFixed(1)} MB`,
        `added ${song.addedAt.slice(0, 10)}`,
        plural(song.playCount, 'play', 'plays'),
        ...(close === undefined ? [] : [`sound ${Math.round(close * 100)}`]),
      ].join(' | ')
    }),
  ].join('\n')
}

export async function findCopies(
  deps: CopiesDeps,
  among: readonly Song[],
  steps: Steps = NO_STEPS,
): Promise<CopiesResult> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  steps.begin(`Looking for songs you have twice among ${plural(among.length, 'song', 'songs')}`)
  const { groups, closeness } = candidateGroups(
    songs,
    new Set(among.map(song => song.id)),
    deps.sound,
    deps.artistNames?.(),
  )
  const copies: TidyCopy[] = []
  const notes: string[] = []
  const exact = groups.filter(exactly)
  for (const group of exact) copies.push(copyOf(group, 'The same song, twice', 'rule'))
  const unsure = groups.filter(group => !exactly(group))
  const asking = unsure.slice(0, MAX_GROUPS)
  if (unsure.length > asking.length) {
    notes.push(
      `Looked at the first ${asking.length} of ${unsure.length} groups; ask again for the rest.`,
    )
  }
  steps.done(
    groups.length === 0
      ? 'None look alike'
      : `${plural(groups.length, 'group', 'groups')} look alike`,
  )

  if (asking.length > 0) {
    steps.begin(`Reading ${plural(asking.length, 'group', 'groups')} of songs that look alike`)
    const failures: LlmError[] = []
    await pool(chunks(asking, GROUPS_PER_CALL), 2, async batch => {
      const prompt = batch.map((group, at) => groupLines(group, at + 1, closeness)).join('\n\n')
      try {
        const reply = await remembered.get(
          Remembered.key('tidy-copies', VERSION, prompt),
          async () =>
            (
              await deps.llm.generate({
                task: 'tidy-copies',
                tier: 'smart',
                system: COPIES_SYSTEM,
                prompt,
                schema: CopiesOut,
              })
            ).value,
        )
        copies.push(...judged(batch, reply))
      } catch (caught) {
        if (!(caught instanceof LlmError)) throw caught
        failures.push(caught)
      }
    })
    const [failure] = failures
    if (failure) {
      const { kind } = failure
      // Stopped is nobody waiting: there is no answer to give.
      if (kind === 'stopped') throw failure
      notes.push(
        `${llmFailureWords[kind]} ${plural(asking.length, 'group', 'groups')} of songs that look alike need the model to tell copies from versions.`,
      )
    }
    steps.done(`${plural(copies.length, 'song', 'songs')} you have twice`)
  }

  return { copies, looked: among.length, note: notes.length > 0 ? notes.join(' ') : null }
}

/** The model's sets, kept to what was shown: songs of the group, each in one set, two or more to a set. */
function judged(batch: readonly Song[][], reply: z.infer<typeof CopiesOut>): TidyCopy[] {
  const out: TidyCopy[] = []
  const seenGroups = new Set<number>()
  for (const answer of reply.groups) {
    const group = batch[answer.g - 1]
    if (!group || seenGroups.has(answer.g)) continue
    seenGroups.add(answer.g)
    const used = new Set<number>()
    for (const set of answer.same) {
      const songs = [...new Set(set)].flatMap(n => {
        const song = group[n - 1]
        return song && !used.has(song.id) ? [song] : []
      })
      // Two albums met through a song on none or a single: kept on purpose, whatever the model says.
      if (songs.length < 2 || albumsOf(songs).size > 1) continue
      for (const song of songs) used.add(song.id)
      out.push(copyOf(songs, answer.why.trim() || 'One recording, twice', 'model'))
    }
  }
  return out
}
