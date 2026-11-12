import { z } from 'zod/v4'
import {
  CJK,
  editDistance,
  splitArtists,
  withoutRepeats,
  withoutTranslation,
  withoutUseNote,
  type ArtistJoinNames,
  type Song,
  type TidyChange,
  type TidyField,
  type TidyResult,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import type { FindNames } from './names.js'
import { NO_STEPS, type Steps } from './progress.js'
import { foldedBare as bare } from './text.js'

/**
 * A4 · Tidy up (docs/features/ai.md): the song names in the library that look
 * wrong, each as a change to approve. Nothing here writes; an approved change
 * is the ordinary edit of a song, made by the device.
 *
 * Rules first, with no model: a name repeated in one credit, words from the
 * video in a title ("(Official Video)"), the artist written into the title,
 * an English translation after a name ("オリオン - Orion"). Then one model
 * call over the names alone, never the songs: two spellings of one artist, a
 * credit that lists the composer beside the performer, an album name that is
 * cut off or garbled. Every name it returns is checked against the library.
 *
 * Without a model the rules still answer, and `note` says what was left out.
 *
 * Asked for something in particular, it does that instead, and only that
 * (askedTidy.ts); asked to make one artist's names one, it groups the names
 * first (oneSpelling.ts).
 */

/** Part of every remembered answer's key: moved when a prompt or a schema changes. */
export const TIDY_VERSION = 8

/** The most names of each kind the model is shown; past that, the most used. */
const MAX_NAMES = 600

const join = (names: readonly string[]): string => names.join(', ')

const VIDEO_WORDS =
  /\s*[([【（「]\s*(?:official\s*)?(?:music\s*video|video|audio|lyrics?\s*video|lyrics?|visuali[sz]er|mv|m\/v|pv|hd|hq|4k|full\s*ver(?:sion|\.)?|official)\s*[)\]】）」]/giu

/** "Idol (Official Music Video)" → "Idol"; "【MV】夜に駆ける" → "夜に駆ける". */
export function withoutVideoWords(title: string): string {
  const cleaned = title.replace(VIDEO_WORDS, '').trim()
  return cleaned || title
}

/** "YOASOBI - 夜に駆ける" by YOASOBI → "夜に駆ける". */
export function withoutArtistPrefix(title: string, credit: string): string {
  for (const name of [credit, ...splitArtists(credit, 'list')]) {
    if (!name) continue
    const prefix = `${name.toLowerCase()} - `
    if (title.toLowerCase().startsWith(prefix) && title.length > prefix.length) {
      return title.slice(prefix.length).trim()
    }
  }
  return title
}

/**
 * Whether two names could be one artist written two ways, and not two people
 * the model mixed up ("Jura Margulis" is not "Vitaly Margulis"): one holds the
 * other, they are in different scripts, they are as long as each other in
 * Chinese (traditional and simplified), or they differ by a letter or two.
 */
export function couldBeOneName(a: string, b: string): boolean {
  const x = bare(a)
  const y = bare(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const cjkA = CJK.test(a)
  const cjkB = CJK.test(b)
  if (cjkA !== cjkB) return true
  if (cjkA) return [...x].length === [...y].length
  const slips = Math.max(1, Math.floor(Math.min(x.length, y.length) / 6))
  return editDistance(x, y, slips) <= slips
}

/** What the model may say: names only, each one it was shown. */
const NamesOut = z.object({
  spellings: z
    .array(
      z.object({
        from: z.string().max(200),
        to: z.string().max(200),
        why: z.string().max(120),
      }),
    )
    .max(80),
  credits: z
    .array(
      z.object({
        from: z.string().max(400),
        to: z.string().max(400),
        why: z.string().max(120),
      }),
    )
    .max(80),
  albums: z
    .array(
      z.object({
        from: z.string().max(200),
        to: z.string().max(200),
        why: z.string().max(120),
      }),
    )
    .max(80),
})
type Names = z.infer<typeof NamesOut>

const NAMES_SYSTEM = `You tidy the names in someone's own music library. You are shown the artist names it uses (each with how many songs), the full artist credits that list more than one name, and its album names (with their artist). Reply with JSON only.

- spellings: one artist written two ways in this library (case, punctuation, spacing, traditional vs simplified Chinese, romanisation). "from" is the spelling to replace, exactly as listed; "to" is the one to keep: the artist's own name in its own script over a romanisation or translation (ロクデナシ over Rokudenashi, 周杰倫 over Jay Chou), otherwise the spelling the library uses most.
- credits: only classical recordings that credit a long-dead composer as if they were performing ("Vitaly Margulis, Frédéric Chopin" → "Vitaly Margulis"). A living composer credited with a studio, band or game ("Yu-Peng Chen, HOYO-MiX") is a real credit: leave it. "from" exactly as listed.
- albums: an album name that is garbled or has stray punctuation. "from" exactly as listed. Take off only what is plainly stray ("Album Name ," → "Album Name"); give a different name only when you are certain of the real one, never a guess between editions. Do not translate names, and do not change a name that is merely unusual.

"why" is at most eight plain words. Propose only what you are sure of; an empty list is a good answer. Never propose a change that keeps the name the same.`

interface Count {
  readonly name: string
  readonly count: number
  readonly by?: string
}

function counted(values: Iterable<{ name: string; by?: string }>): Count[] {
  const counts = new Map<string, Count>()
  for (const { name, by } of values) {
    const key = `${name}\u0000${by ?? ''}`
    const had = counts.get(key)
    counts.set(key, { name, by, count: (had?.count ?? 0) + 1 })
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_NAMES)
}

/** The prompt: names, credits and albums, never a title or anything else about a song. */
export function namesPrompt(songs: readonly Song[]): string {
  const names = counted(
    songs.flatMap(song => splitArtists(song.artist, 'list').map(name => ({ name }))),
  )
  const credits = counted(
    songs
      .map(song => withoutRepeats(song.artist))
      .filter(credit => splitArtists(credit, 'list').length > 1)
      .map(name => ({ name })),
  )
  const albums = counted(
    songs
      .filter(song => song.album)
      .map(song => ({
        name: song.album,
        by: splitArtists(song.albumArtist || song.artist, 'list')[0],
      })),
  )
  return [
    'Artist names:',
    ...names.map(entry => `- ${entry.name} (${entry.count})`),
    '',
    'Credits with more than one name:',
    ...(credits.length ? credits.map(entry => `- ${entry.name} (${entry.count})`) : ['(none)']),
    '',
    'Albums:',
    ...albums.map(entry => `- ${entry.name} · ${entry.by ?? 'unknown'} (${entry.count})`),
  ].join('\n')
}

/** One song's field, what it would become, and why. */
export interface Edit {
  value: string
  whys: string[]
}

export interface TidyDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  /** Artists' other names, which may say two of the library's names are one artist. */
  readonly artistNames?: () => ArtistJoinNames
  /** How each Chinese or Japanese name is spelt in Latin letters (services/spellings.ts). */
  readonly spellings?: () => ReadonlyMap<string, readonly string[]>
  readonly remembered?: Remembered
  /** The catalogues, for a request that wants names from outside the library. */
  readonly findNames?: FindNames
  /** Whether songs no catalogue has may be looked for on the web: always, as the server runs it. */
  readonly web?: () => boolean
}

/** A request for one change across some songs, and the songs it is about. */
export interface TidyAsked {
  readonly text: string
  readonly songs: readonly Song[]
  /** Names the request used that the library does not have. */
  readonly unknown: readonly string[]
  /** Whether the names must come from outside the library: official, real, an album's own. */
  readonly lookUp: boolean
  /** The most songs to change, when they said ("up to 300"); null for all of them. */
  readonly limit?: number | null
}

export async function tidy(
  deps: TidyDeps,
  steps: Steps = NO_STEPS,
  /** The songs a checkup is about, when the request chose some: no change reaches past them. */
  among: readonly Song[] | null = null,
): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = among ?? deps.songs()
  if (songs.length === 0) {
    return { changes: [], looked: 0, note: null, asked: null, reply: null, gaps: gapsIn(songs) }
  }
  steps.begin(`Reading the names of ${songs.length} songs`)

  let names: Names = { spellings: [], credits: [], albums: [] }
  let note: string | null = null
  const prompt = namesPrompt(songs)
  try {
    names = await remembered.get(
      Remembered.key('tidy-names', TIDY_VERSION, prompt),
      async () =>
        (
          await deps.llm.generate({
            task: 'tidy-names',
            tier: 'smart',
            system: NAMES_SYSTEM,
            prompt,
            schema: NamesOut,
          })
        ).value,
    )
  } catch (caught) {
    if (!(caught instanceof LlmError)) throw caught
    note = `${llmFailureWords[caught.kind]} Only the plain fixes are here: two spellings of one artist and odd album names need the model.`
  }

  steps.begin('Checking every name by the rules')
  const changes = changesFor(songs, names)
  steps.done(`${changes.length} ${changes.length === 1 ? 'thing' : 'things'} to fix`)
  return { changes, looked: songs.length, note, asked: null, reply: null, gaps: gapsIn(songs) }
}

/** How many songs miss an album, a year or a cover, each and in all: what a checkup lists. */
export function gapsIn(songs: readonly Song[]): NonNullable<TidyResult['gaps']> {
  const gaps = { songs: 0, album: 0, year: 0, cover: 0 }
  for (const song of songs) {
    const missing = missingFrom(song)
    if (missing.length > 0) gaps.songs++
    for (const field of missing) gaps[field]++
  }
  return gaps
}

/** What a song lacks of what a catalogue can fill in. */
export function missingFrom(song: Song): ('album' | 'year' | 'cover')[] {
  return [
    ...(song.album.trim() === '' ? (['album'] as const) : []),
    ...(song.year === null ? (['year'] as const) : []),
    ...(song.hasArt ? [] : (['cover'] as const)),
  ]
}

/** Rules and the model's names, applied to every song, grouped into changes. */
function changesFor(songs: readonly Song[], names: Names): TidyChange[] {
  // What the model said, kept to names it was shown and changes that change something.
  const artistNames = new Set(songs.flatMap(song => splitArtists(song.artist, 'list')))
  const credits = new Set(songs.map(song => withoutRepeats(song.artist)))
  const albums = new Set(songs.map(song => song.album).filter(Boolean))
  const real = (from: string, to: string, known: Set<string>): boolean =>
    known.has(from) && to.trim() !== '' && to.trim() !== from
  // A spelling is kept only for two names the library has that could be one, and always points at
  // the artist's own script when the library has both: ロクデナシ, not Rokudenashi.
  const spelling = new Map(
    names.spellings
      .filter(entry => real(entry.from, entry.to, artistNames))
      // Both spellings are already here: a name the library never uses is a translation.
      .filter(entry => artistNames.has(entry.to.trim()))
      .filter(entry => couldBeOneName(entry.from, entry.to))
      .map(entry =>
        CJK.test(entry.from) && !CJK.test(entry.to) && artistNames.has(entry.to.trim())
          ? { from: entry.to.trim(), to: entry.from, why: 'Same artist, in their own script' }
          : entry,
      )
      .map(entry => [entry.from, entry]),
  )
  const credit = new Map(
    names.credits
      .filter(entry => real(entry.from, entry.to, credits))
      .map(entry => [entry.from, entry]),
  )
  const album = new Map(
    names.albums
      .filter(entry => real(entry.from, entry.to, albums))
      .map(entry => [entry.from, entry]),
  )

  const { propose, changes } = grouped()

  for (const song of songs) {
    // The artist: repeats, then spellings name by name, then the credit as a whole.
    const artist: Edit = { value: song.artist, whys: [] }
    let byModel = false
    const once = withoutRepeats(artist.value)
    if (once !== artist.value) artist.whys.push('The same name twice')
    artist.value = once
    const spelled = splitArtists(artist.value, 'list').map(
      name => spelling.get(name)?.to.trim() ?? name,
    )
    const respelled = withoutRepeats(join(spelled))
    if (splitArtists(artist.value, 'list').some(name => spelling.has(name))) {
      artist.whys.push(
        ...new Set(splitArtists(artist.value, 'list').flatMap(n => spelling.get(n)?.why ?? [])),
      )
      artist.value = respelled
      byModel = true
    }
    const whole = credit.get(artist.value) ?? credit.get(once)
    if (whole) {
      artist.whys.push(whole.why)
      artist.value = whole.to.trim()
      byModel = true
    }
    propose(song, 'artist', song.artist, artist, byModel ? 'model' : 'rule')

    if (song.albumArtist) {
      const albumArtist: Edit = { value: withoutRepeats(song.albumArtist), whys: [] }
      if (albumArtist.value !== song.albumArtist) albumArtist.whys.push('The same name twice')
      propose(song, 'albumArtist', song.albumArtist, albumArtist, 'rule')
    }

    // The title: words from the video, the artist in front, a translation or
    // a note on where it was used after.
    const title: Edit = { value: song.title, whys: [] }
    const steps: [(value: string) => string, string][] = [
      [withoutVideoWords, 'Words from the video, not the name'],
      [value => withoutArtistPrefix(value, song.artist), 'The artist is in the title'],
      [withoutTranslation, 'An English translation after the name'],
      [withoutUseNote, 'Where the song was used, not its name'],
    ]
    for (const [step, why] of steps) {
      const next = step(title.value)
      if (next !== title.value) {
        title.value = next
        title.whys.push(why)
      }
    }
    propose(song, 'title', song.title, title, 'rule')

    const renamed = album.get(song.album)
    if (renamed) {
      propose(song, 'album', song.album, { value: renamed.to.trim(), whys: [renamed.why] }, 'model')
    }
  }

  return changes()
}

/** Edits song by song, gathered into one change per (field, from, to, why). */
export function grouped() {
  const groups = new Map<string, TidyChange & { songIds: number[] }>()
  const propose = (
    song: Song,
    field: TidyField,
    from: string,
    edit: Edit,
    by: TidyChange['by'],
  ): void => {
    if (edit.value === from) return
    const why = edit.whys.join(' · ')
    const key = `${field}\u0000${from}\u0000${edit.value}\u0000${why}`
    const group = groups.get(key)
    if (group) group.songIds.push(song.id)
    else {
      const id = Remembered.key(field, from, edit.value, why).slice(0, 16)
      groups.set(key, { key: id, field, from, to: edit.value, why, by, songIds: [song.id] })
    }
  }
  const order: Record<TidyField, number> = {
    artist: 0,
    albumArtist: 1,
    album: 2,
    title: 3,
    year: 4,
    cover: 5,
  }
  const changes = (): TidyChange[] =>
    [...groups.values()].sort(
      (a, b) =>
        order[a.field] - order[b.field] ||
        b.songIds.length - a.songIds.length ||
        a.from.localeCompare(b.from),
    )
  return { propose, changes }
}
