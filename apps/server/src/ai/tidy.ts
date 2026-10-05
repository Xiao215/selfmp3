import { z } from 'zod/v4'
import {
  CJK,
  SongFieldsSchema,
  TidyFieldSchema,
  creditList as listed,
  plural,
  withoutRepeats,
  withoutTranslation,
  withoutUseNote,
  type Song,
  type TidyChange,
  type TidyField,
  type TidyResult,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords, Remembered, type Llm } from './llm.js'
import { foundFor, within, type FindNames, type FoundName } from './names.js'

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
 *
 * Asked for something in particular ("give the 原神音乐 songs their official
 * Chinese names, albums too"), it does that instead, and only that: the songs
 * the request is about go to the model in batches, titles and all, and each
 * edit it returns is checked against the song it names. When the request
 * wants names from outside the library ("official Chinese names"), each song
 * is looked up in the catalogues first (`names.ts`); the model only shapes a
 * name it was shown, and an edit whose words are in no catalogue's name is
 * dropped, so nothing is made up.
 *
 * Before the lookups, the model reads the chosen songs' names alone and keeps
 * the ones the change is still to be made on ("the ones in English now"):
 * which songs need it is whatever the request says, not a filter of ours. A
 * number they give ("up to 300") is taken from those.
 */

const VERSION = 5

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
  /** The catalogues, for a request that wants names from outside the library. */
  readonly findNames?: FindNames
  /** Settings' web switch: songs no catalogue has may be looked for on the web. */
  readonly web?: () => boolean
}

/** A request for one change across some songs, and the songs it is about. */
interface TidyAsked {
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
  asked: TidyAsked | null = null,
): Promise<TidyResult> {
  const remembered = deps.remembered ?? new Remembered()
  if (asked) return askedTidy(deps, remembered, asked, steps)
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
  return { changes, looked: songs.length, note, asked: null }
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

  const { propose, changes } = grouped()

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

  return changes()
}

/** Edits song by song, gathered into one change per (field, from, to, why). */
function grouped() {
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
  const order: Record<TidyField, number> = { artist: 0, albumArtist: 1, album: 2, title: 3 }
  const changes = (): TidyChange[] =>
    [...groups.values()].sort(
      (a, b) =>
        order[a.field] - order[b.field] ||
        b.songIds.length - a.songIds.length ||
        a.from.localeCompare(b.from),
    )
  return { propose, changes }
}

/** Songs per model call: a line is about 40 tokens in and an edit about 30 out. */
const SONGS_PER_CALL = 60
/** Calls at once, so a big request does not run into the provider's rate limit. */
const CALLS_AT_ONCE = 4
/** The most songs one request changes: as many as one edit can save. */
const MAX_ASKED = 2000

const EditsOut = z.object({
  edits: z
    .array(
      z.object({
        n: z.number().int(),
        field: z.enum(TidyFieldSchema.options),
        to: z.string().max(400),
        why: z.string().max(120),
      }),
    )
    .max(SONGS_PER_CALL * 4),
})

const ASKED_SYSTEM = `You change the names in someone's own music library the way they ask. You are given their request and a numbered table of the songs it is about (n | title | artist | album | album artist). Reply with JSON only: edits, each a song's number (n), the field to change (title, artist, album or albumArtist), what it becomes (to), and why.

- Only what the request asks for, on the fields it asks about. Leave a song out when it is right already, or when you do not know the answer for certain: never guess or make up a name. When they ask for official names, give a name the artist or publisher uses, not one you translated yourself.
- Every song on one album gets the same album name.
- why: at most six plain words, the same words for every edit made for the same reason ("Official Chinese name").
- Never use a number that is not in the table, and never an edit that keeps the name the same.`

/** Added when the songs were looked up: what was found is the only place a name may come from. */
const FOUND_RULES = `

Each song may be followed by "found": what music catalogues (网易云, MusicBrainz, iTunes) list for this same recording, matched by its artist and length. Every name you give comes from a found name, in its own words, shaped the way they ask:
- A found name in two languages ("丹砂巍巍 Wordless Cliffs") keeps only the part in the language they want ("丹砂巍巍" for Chinese).
- Leave off a game's or series' prefix ("原神-千岩旷望 Millelith's Watch" is 千岩旷望 for an album) unless they ask for it.
- A song with nothing found, or nothing found that fits, is left out. Never write a name that is not in what was found.`

/** Added for songs no catalogue has, when Settings lets the model search the web. */
const WEB_RULES = `

None of these songs is in the music catalogues. Search the web for each one's name the way they ask: the artist's or publisher's own pages, stores, wikis. Give a name only when a page you read gives it for this same song, and leave the rest out.`

/** Songs per web call: each may mean a few searches. */
const WEB_PER_CALL = 15
/** The most songs looked for on the web in one request. */
const MAX_WEB = 150

/** Songs per sorting call: a line is about 20 tokens in and a number 3 out. */
const SORT_PER_CALL = 200

const SortOut = z.object({ n: z.array(z.number().int()).max(SORT_PER_CALL) })

const SORT_SYSTEM = `You sort someone's songs before a change they asked for is made to their names. You are given their request and a numbered table of songs (n | title | artist | album | album artist). Reply with JSON only: n, the numbers of the songs the change is still to be made on.

- Leave out a song the request leaves out (it asks only for the titles in English, and this title is Chinese already), and one whose names already are the way they want them.
- Keep a song whenever you can't tell from the table: it is checked properly after this.
- Never use a number that is not in the table.`

/** Lookups at once: 网易云 answers quickly, and MusicBrainz waits its turn on its own. */
const LOOKUPS_AT_ONCE = 3

/** `run` over every item, `width` at a time, each taking the next as it finishes. */
async function pool<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!)
    }),
  )
}

/** A found name as the model is shown it. */
const foundLine = (found: readonly FoundName[]): string =>
  found
    .slice(0, 3)
    .map(each => `${each.source} “${each.title}” by ${each.artist} on “${each.album || '-'}”`)
    .join('; ')

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The songs the request still wants changed, in the order given, from a fast
 * read of their names. A batch the model can't answer keeps all its songs:
 * the careful step after this one judges them.
 */
async function needingIt(
  llm: Llm,
  remembered: Remembered,
  text: string,
  songs: readonly Song[],
  steps: Steps,
): Promise<Song[]> {
  const all = songs.length.toLocaleString('en')
  steps.begin(`Finding which of ${all} songs need it`)
  const keep = new Set<number>()
  await pool(chunks(songs, SORT_PER_CALL), CALLS_AT_ONCE, async batch => {
    const table = batch
      .map(
        (song, index) =>
          `${index + 1} | ${song.title} | ${song.artist || '-'} | ${song.album || '-'} | ${song.albumArtist || '-'}`,
      )
      .join('\n')
    const prompt = `The request:\n${text}\n\nThe songs (n | title | artist | album | album artist):\n${table}`
    try {
      const answer = await remembered.get(
        Remembered.key('tidy-sort', VERSION, prompt),
        async () =>
          (
            await llm.generate({
              task: 'tidy-sort',
              tier: 'fast',
              system: SORT_SYSTEM,
              prompt,
              schema: SortOut,
            })
          ).value,
      )
      for (const n of answer.n) {
        const song = batch[n - 1]
        if (song) keep.add(song.id)
      }
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      for (const song of batch) keep.add(song.id)
    }
  })
  const needing = songs.filter(song => keep.has(song.id))
  steps.done(`${needing.length.toLocaleString('en')} of ${all} need it`)
  return needing
}

/** One change asked for across the songs it is about, a batch at a time. */
async function askedTidy(
  deps: TidyDeps,
  remembered: Remembered,
  asked: TidyAsked,
  steps: Steps,
): Promise<TidyResult> {
  const { llm } = deps
  const notes: string[] = []
  if (asked.unknown.length > 0) notes.push(`Your library has no ${asked.unknown.join(' or ')}.`)
  // An album's songs side by side, so one batch names the whole album.
  const chosen = [...asked.songs].sort(
    (a, b) =>
      (a.albumArtist || a.artist).localeCompare(b.albumArtist || b.artist) ||
      a.album.localeCompare(b.album) ||
      (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
      a.id - b.id,
  )
  const lookingUp = asked.lookUp && deps.findNames !== undefined
  if (asked.lookUp && !deps.findNames) notes.push('Names can’t be looked up from here.')
  const cap = Math.min(asked.limit ?? MAX_ASKED, MAX_ASKED)

  // 0 · The songs the change is still to be made on, from their names alone: before
  // the slow lookups, and before a number they gave is counted out.
  const sorting = (lookingUp && chosen.length > SONGS_PER_CALL) || chosen.length > cap
  const needing = sorting ? await needingIt(llm, remembered, asked.text, chosen, steps) : chosen
  const songs = needing.slice(0, cap)
  if (needing.length > songs.length) {
    const of = needing.length.toLocaleString('en')
    notes.push(
      sorting
        ? `Changing the first ${songs.length.toLocaleString('en')} of the ${of} songs that need it; ask again for the rest.`
        : `Looked at the first ${songs.length.toLocaleString('en')} of ${of} songs; ask again for the rest.`,
    )
  }
  if (songs.length === 0) {
    steps.done('0 changes')
    return { changes: [], looked: chosen.length, note: notes.join(' ') || null, asked: asked.text }
  }

  // 1 · The catalogues, when the names must come from outside: a song none of them has is left be.
  const found = new Map<number, FoundName[]>()
  if (lookingUp) {
    const findNames = deps.findNames
    const all = songs.length.toLocaleString('en')
    let looked = 0
    steps.begin(
      `Looking up ${all} ${songs.length === 1 ? 'song' : 'songs'} on 网易云 and MusicBrainz`,
    )
    await pool(songs, LOOKUPS_AT_ONCE, async song => {
      const names = await findNames(song)
      if (names.length > 0) found.set(song.id, names)
      looked++
      if (looked % 25 === 0 && looked < songs.length) {
        steps.begin(`Looked up ${looked.toLocaleString('en')} of ${all} songs`)
      }
    })
    const notFound = songs.length - found.size
    steps.done(`Found ${found.size.toLocaleString('en')} of ${all}`)
    if (notFound > 0) {
      notes.push(
        deps.web?.()
          ? `${plural(notFound, 'song wasn’t', 'songs weren’t')} found on 网易云, MusicBrainz or iTunes, so the web was searched instead: what it found waits for a yes.`
          : `${plural(notFound, 'song wasn’t', 'songs weren’t')} found on 网易云, MusicBrainz or iTunes, so ${notFound === 1 ? 'it is' : 'they are'} left as ${notFound === 1 ? 'it is' : 'they are'}.`,
      )
    }
  }
  const asking = lookingUp ? songs.filter(song => found.has(song.id)) : songs

  // 2 · The model, a batch at a time.
  const batches = chunks(asking, SONGS_PER_CALL)
  const { propose, changes } = grouped()
  let done = 0
  const failures: LlmError[] = []
  let missed = 0
  const total = asking.length.toLocaleString('en')
  if (asking.length > 0) steps.begin(`Reading ${total} ${asking.length === 1 ? 'song' : 'songs'}`)

  const run = async (batch: Song[]): Promise<void> => {
    const table = batch
      .map(
        (song, index) =>
          `${index + 1} | ${song.title} | ${song.artist || '-'} | ${song.album || '-'} | ${song.albumArtist || '-'}${lookingUp ? ` | found: ${foundLine(found.get(song.id) ?? [])}` : ''}`,
      )
      .join('\n')
    const prompt = `The request:\n${asked.text}\n\nThe songs (n | title | artist | album | album artist${lookingUp ? ' | found' : ''}):\n${table}`
    let answer: z.infer<typeof EditsOut>
    try {
      answer = await remembered.get(
        Remembered.key('tidy-asked', VERSION, prompt),
        async () =>
          (
            await llm.generate({
              task: 'tidy-asked',
              tier: 'smart',
              system: lookingUp ? ASKED_SYSTEM + FOUND_RULES : ASKED_SYSTEM,
              prompt,
              schema: EditsOut,
            })
          ).value,
      )
    } catch (caught) {
      if (!(caught instanceof LlmError)) throw caught
      failures.push(caught)
      missed += batch.length
      return
    }
    // The check: a song in this batch, a field once each, a name a song may have.
    const seen = new Set<string>()
    for (const edit of answer.edits) {
      const song = batch[edit.n - 1]
      const to = edit.to.trim().replace(/\s+/g, ' ')
      const at = `${edit.n}:${edit.field}`
      if (!song || seen.has(at)) continue
      if (!SongFieldsSchema.shape[edit.field].safeParse(to).success) continue
      if (lookingUp) {
        // Only words a catalogue has for this recording: the one it came from says why, and it starts ticked.
        const source = (found.get(song.id) ?? []).find(each =>
          within(to, foundFor(edit.field, each)),
        )
        if (!source) continue
        seen.add(at)
        const why = `The name on ${source.source}`
        propose(song, edit.field, song[edit.field], { value: to, whys: [why] }, 'rule')
        continue
      }
      seen.add(at)
      const why = edit.why.trim() || 'As you asked'
      propose(song, edit.field, song[edit.field], { value: to, whys: [why] }, 'model')
    }
    done += batch.length
    steps.begin(`Read ${done.toLocaleString('en')} of ${total} songs`)
  }

  await pool(batches, CALLS_AT_ONCE, run)
  const [failure] = failures
  if (failure && missed === asking.length) throw failure
  if (failure) {
    notes.push(
      `${llmFailureWords[failure.kind]} Left out ${plural(missed, 'song', 'songs')}; ask again for them.`,
    )
  }

  // 3 · The web, for songs no catalogue has, when Settings allows: the model's finds, unticked.
  const unfound =
    lookingUp && deps.web?.() ? songs.filter(song => !found.has(song.id)).slice(0, MAX_WEB) : []
  if (unfound.length > 0) {
    let webMissed = 0
    steps.begin(`Searching the web for ${plural(unfound.length, 'song', 'songs')}`)
    await pool(chunks(unfound, WEB_PER_CALL), 2, async batch => {
      const table = batch
        .map(
          (song, index) =>
            `${index + 1} | ${song.title} | ${song.artist || '-'} | ${song.album || '-'} | ${song.albumArtist || '-'}`,
        )
        .join('\n')
      const prompt = `The request:\n${asked.text}\n\nThe songs (n | title | artist | album | album artist):\n${table}`
      let answer: z.infer<typeof EditsOut>
      try {
        answer = await remembered.get(
          Remembered.key('tidy-web', VERSION, prompt),
          async () =>
            (
              await llm.generate({
                task: 'tidy-web',
                tier: 'smart',
                system: ASKED_SYSTEM + WEB_RULES,
                prompt,
                schema: EditsOut,
                webSearch: true,
              })
            ).value,
        )
      } catch (caught) {
        if (!(caught instanceof LlmError)) throw caught
        webMissed += batch.length
        return
      }
      const seen = new Set<string>()
      for (const edit of answer.edits) {
        const song = batch[edit.n - 1]
        const to = edit.to.trim().replace(/\s+/g, ' ')
        const at = `${edit.n}:${edit.field}`
        if (!song || seen.has(at)) continue
        if (!SongFieldsSchema.shape[edit.field].safeParse(to).success) continue
        seen.add(at)
        propose(
          song,
          edit.field,
          song[edit.field],
          { value: to, whys: ['Found on the web'] },
          'model',
        )
      }
    })
    if (webMissed > 0) notes.push(`The web search left out ${plural(webMissed, 'song', 'songs')}.`)
  }

  const proposed = changes()
  steps.done(`${proposed.length} ${proposed.length === 1 ? 'change' : 'changes'}`)
  return {
    changes: proposed,
    // Every song chosen was checked, unless a number they gave left some for later.
    looked: needing.length > songs.length ? songs.length : chosen.length,
    note: notes.length > 0 ? notes.join(' ') : null,
    asked: asked.text,
  }
}
