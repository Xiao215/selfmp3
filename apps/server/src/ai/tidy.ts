import { z } from 'zod/v4'
import {
  CJK,
  creditList as listed,
  withoutRepeats,
  withoutTranslation,
  withoutUseNote,
  type Song,
  type TidyChange,
  type TidyField,
  type TidyResult,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'

import { NO_STEPS, type Steps } from './progress.js'
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
 */

const VERSION = 4

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
  for (const name of [credit, ...listed(credit)]) {
    if (!name) continue
    const prefix = `${name.toLowerCase()} - `
    if (title.toLowerCase().startsWith(prefix) && title.length > prefix.length) {
      return title.slice(prefix.length).trim()
    }
  }
  return title
}

/** Letters only, lower case, accents off: "Frédéric" and "frederic" are one. */
const bare = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = row
  }
  return previous[b.length]!
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
  return distance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 6))
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
  const names = counted(songs.flatMap(song => listed(song.artist).map(name => ({ name }))))
  const credits = counted(
    songs
      .map(song => withoutRepeats(song.artist))
      .filter(credit => listed(credit).length > 1)
      .map(name => ({ name })),
  )
  const albums = counted(
    songs
      .filter(song => song.album)
      .map(song => ({ name: song.album, by: listed(song.albumArtist || song.artist)[0] })),
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
interface Edit {
  value: string
  whys: string[]
}

interface TidyDeps {
  readonly llm: Llm
  readonly songs: () => Song[]
  readonly remembered?: Remembered
}

export async function tidy(deps: TidyDeps, steps: Steps = NO_STEPS): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  steps.begin(`Reading the names of ${songs.length} songs`)

  let names: Names = { spellings: [], credits: [], albums: [] }
  let note: string | null = null
  const prompt = namesPrompt(songs)
  try {
    names = await remembered.get(
      Remembered.key('tidy-names', VERSION, prompt),
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
  return { changes, looked: songs.length, note }
}

/** Rules and the model's names, applied to every song, grouped into changes. */
function changesFor(songs: readonly Song[], names: Names): TidyChange[] {
  // What the model said, kept to names it was shown and changes that change something.
  const artistNames = new Set(songs.flatMap(song => listed(song.artist)))
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

  const groups = new Map<string, TidyChange & { songIds: number[] }>()
  const propose = (
    song: Song,
    field: TidyField,
    from: string,
    edit: Edit,
    by: TidyChange['by'],
  ) => {
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

  for (const song of songs) {
    // The artist: repeats, then spellings name by name, then the credit as a whole.
    const artist: Edit = { value: song.artist, whys: [] }
    let byModel = false
    const once = withoutRepeats(artist.value)
    if (once !== artist.value) artist.whys.push('The same name twice')
    artist.value = once
    const spelled = listed(artist.value).map(name => spelling.get(name)?.to.trim() ?? name)
    const respelled = withoutRepeats(join(spelled))
    if (listed(artist.value).some(name => spelling.has(name))) {
      artist.whys.push(...new Set(listed(artist.value).flatMap(n => spelling.get(n)?.why ?? [])))
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

  const order: Record<TidyField, number> = { artist: 0, albumArtist: 1, album: 2, title: 3 }
  return [...groups.values()].sort(
    (a, b) =>
      order[a.field] - order[b.field] ||
      b.songIds.length - a.songIds.length ||
      a.from.localeCompare(b.from),
  )
}
