import { z } from 'zod/v4'
import {
  editDistance,
  formatDuration,
  libraryArtists,
  namesFor,
  type ArtistJoinNames,
  type Song,
  type Tag,
  type Understanding,
} from '@selfmp3/shared'
import { normalizeForMatch } from '../services/youtubeMatch.js'
import { EVERYTHING } from './askLibrary.js'
import { groundPlan, songsFitting } from './describe.js'
import { atPlaces, PLAYING, scopeOf, type Held } from './scope.js'

/**
 * The songs one Ask request is working with (AGENT-DESIGN 2.2): named lists,
 * the model's own and the ones the request came with. The request brings the
 * song playing (`playing`), what earlier answers showed, by the handle the
 * device gave each (`t2.1`), and the one on their screen again as `screen`;
 * every tool that finds songs keeps them under a name the model chooses
 * (`as`), and every tool that takes songs takes a scope: a set's name, places
 * in its list, ids, and filters over them, resolved here, in code. So a model
 * never copies a list of ids from one call to the next, and "the 3rd one" is
 * a place, counted here.
 *
 * Ids a model names are only ever ones it has been shown or that a set
 * holds: anything else is refused, said back to it as the tool's error. A
 * filter that empties a list says which one did, and a name the library does
 * not have says so with the names nearest it, rather than being dropped and
 * the list quietly widened.
 */

/** How many rows of a set a tool's answer shows; the count and minutes are of all of it. */
const ROWS_SHOWN = 30
/** How many names "did you mean" offers. */
const NEAR_SHOWN = 3

/** The library as the tools read it, for this request. */
export interface Library {
  readonly songs: readonly Song[]
  readonly tags: readonly Tag[]
  readonly names: ArtistJoinNames
  readonly now: number
  readonly lyrics: (query: string) => { songId: number; line: string }[]
}

const Range = z.object({ min: z.number().nullish(), max: z.number().nullish() })
const NameList = (most: number) => z.array(z.string().min(1).max(most)).max(12)

/** Conditions on songs, every one given must hold. */
export const FilterFields = {
  /** Words in the title, artist, album or lyrics. */
  text: z.string().min(1).max(120).nullish(),
  title: z.string().min(1).max(120).nullish(),
  artist: NameList(120).nullish(),
  album: NameList(200).nullish(),
  tags: NameList(80).nullish(),
  notTags: NameList(80).nullish(),
  energy: Range.nullish(),
  bpm: Range.nullish(),
  year: Range.nullish(),
  words: z.enum(['with', 'without']).nullish(),
  lyrics: z.string().min(1).max(120).nullish(),
  loved: z.boolean().nullish(),
  playedWithinDays: z.number().int().min(1).max(3650).nullish(),
  notPlayedWithinDays: z.number().int().min(1).max(3650).nullish(),
  addedWithinDays: z.number().int().min(1).max(3650).nullish(),
}
export const FiltersArg = z.object(FilterFields)
export type Filters = z.infer<typeof FiltersArg>

/** Which songs a tool works on: a set, places in it, ids, and filters over them. */
export const ScopeArg = z.object({
  set: z.string().min(1).max(24).nullish(),
  /** Places in the set's list, 1 for the first. */
  pick: z.array(z.number().int().min(1).max(5000)).max(200).nullish(),
  ids: z.array(z.number().int()).max(500).nullish(),
  filters: FiltersArg.nullish(),
})
export type ScopeArg = z.infer<typeof ScopeArg>

/** A name a model gives a set. */
export const SetName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,23}$/, 'a letter, then letters, digits, _ or -')

/** A name the library does not have, and the ones it has nearest it. */
interface Unmatched {
  readonly kind: 'artist' | 'album' | 'tag'
  readonly name: string
  readonly didYouMean: readonly string[]
}

/** Songs a scope or a filter came to, and what made them none or left a name out. */
interface Resolved {
  readonly songs: Song[]
  /** The condition that left no songs, with how many there were before it. */
  readonly emptiedBy: string | null
  readonly unmatched: readonly Unmatched[]
}

interface NamedSet {
  readonly songs: readonly Song[]
  readonly label: string
  /** Why each song is in it, where a pick said. */
  readonly why: ReadonlyMap<number, string>
}

/** A proposal a tool made, kept for the answer to name. */
export interface Proposal {
  readonly kind: 'tags' | 'tidy' | 'copies'
  readonly value: unknown
}

/** A candidate for "did you mean": a name the library has and the other names it answers to. */
interface Candidate {
  readonly name: string
  readonly also?: readonly string[]
  readonly songs: number
}

/**
 * The names a query is nearest, best first: the same once case, accents,
 * punctuation and script are folded (Chinese to pinyin), then one holding the
 * other, then a few slips off.
 */
export function nearNames(
  query: string,
  candidates: readonly Candidate[],
  most = NEAR_SHOWN,
): Candidate[] {
  const wanted = normalizeForMatch(query)
  if (!wanted) return []
  const slips = Math.max(2, Math.floor(wanted.length * 0.3))
  const distance = (name: string): number => {
    const key = normalizeForMatch(name)
    if (!key) return Infinity
    if (key === wanted) return 0
    if (key.includes(wanted) || (key.length >= 3 && wanted.includes(key))) return 1
    const far = editDistance(wanted, key, slips)
    return far <= slips ? 1 + far : Infinity
  }
  return candidates
    .map(each => ({
      each,
      far: Math.min(...[each.name, ...(each.also ?? [])].map(distance)),
    }))
    .filter(scored => scored.far !== Infinity)
    .sort((a, b) => a.far - b.far || b.each.songs - a.each.songs)
    .slice(0, most)
    .map(scored => scored.each)
}

/** The library's artists, albums or tags, each with its other names and how many songs. */
export function candidatesOf(library: Library, kind: Unmatched['kind']): Candidate[] {
  if (kind === 'artist') {
    return libraryArtists(library.songs).map(artist => ({
      name: artist.name,
      also: namesFor(library.names.artistNames, artist.key),
      songs: artist.songIds.length,
    }))
  }
  if (kind === 'tag') {
    return library.tags.map(tag => ({
      name: tag.name,
      songs: library.songs.filter(song => song.tagIds.includes(tag.id)).length,
    }))
  }
  const albums = new Map<string, number>()
  for (const song of library.songs) {
    if (song.album) albums.set(song.album, (albums.get(song.album) ?? 0) + 1)
  }
  return [...albums].map(([name, songs]) => ({ name, songs }))
}

const rangeOf = (range: z.infer<typeof Range> | null | undefined) => ({
  min: range?.min ?? null,
  max: range?.max ?? null,
})
const rangeWords = (what: string, range: { min: number | null; max: number | null }): string =>
  `${what} ${range.min ?? '…'}–${range.max ?? '…'}`

/**
 * The songs among these that every given condition holds for. Names are the
 * library's own once folded (Describe's `groundPlan`: other names, script,
 * a slip); a name it has none of matches no song, and is said with the
 * names nearest it. The conditions are applied one at a time, so a list
 * that comes to nothing says which condition emptied it.
 */
export function applyFilters(songs: readonly Song[], filters: Filters, library: Library): Resolved {
  const asked = {
    anyTags: filters.tags ?? [],
    noTags: filters.notTags ?? [],
    artists: filters.artist ?? [],
    albums: filters.album ?? [],
  }
  const { understanding, unknown } = groundPlan(
    { ...EVERYTHING, ...asked },
    library.songs,
    library.tags,
    library.names,
  )
  const blank: Understanding = {
    ...understanding,
    anyTags: [],
    noTags: [],
    artists: [],
    albums: [],
  }
  const fitting =
    (part: Partial<Understanding>) =>
    (among: readonly Song[]): Song[] =>
      songsFitting(among, library.tags, { ...blank, ...part }, library.now, library.names)
  const unmatched: Unmatched[] = []
  const conditions: { said: string; keep: (among: readonly Song[]) => Song[] }[] = []

  const places = [
    { kind: 'artist', given: asked.artists, found: understanding.artists, key: 'artists' },
    { kind: 'album', given: asked.albums, found: understanding.albums, key: 'albums' },
    { kind: 'tag', given: asked.anyTags, found: understanding.anyTags, key: 'anyTags' },
  ] as const
  for (const place of places) {
    if (place.given.length === 0) continue
    const missing = place.given.filter(name => unknown.includes(name))
    for (const name of missing) {
      unmatched.push({
        kind: place.kind,
        name,
        didYouMean: nearNames(name, candidatesOf(library, place.kind)).map(each => each.name),
      })
    }
    conditions.push(
      place.found.length > 0
        ? {
            said: `${place.kind} ${place.found.join(' or ')}`,
            keep: fitting({ [place.key]: place.found }),
          }
        : {
            said: `${place.kind} ${place.given.join(' or ')} (not in the library)`,
            keep: () => [],
          },
    )
  }

  const has = (whole: string, part: string): boolean => {
    const folded = normalizeForMatch(part)
    return (
      whole.toLowerCase().includes(part.trim().toLowerCase()) ||
      (folded.length > 0 && normalizeForMatch(whole).includes(folded))
    )
  }
  const inLyrics = (query: string): Set<number> =>
    new Set(library.lyrics(query.trim()).map(hit => hit.songId))
  if (filters.title) {
    const title = filters.title
    conditions.push({
      said: `title holding “${title}”`,
      keep: among => among.filter(song => has(song.title, title)),
    })
  }
  if (filters.text) {
    const text = filters.text
    const sung = inLyrics(text)
    conditions.push({
      said: `“${text}” in a name or the lyrics`,
      keep: among =>
        among.filter(
          song => has(`${song.title} ${song.artist} ${song.album}`, text) || sung.has(song.id),
        ),
    })
  }
  if (filters.lyrics) {
    const sung = inLyrics(filters.lyrics)
    conditions.push({
      said: `lyrics holding “${filters.lyrics}”`,
      keep: among => among.filter(song => sung.has(song.id)),
    })
  }
  if (asked.noTags.length > 0) {
    for (const name of asked.noTags.filter(each => unknown.includes(each))) {
      unmatched.push({
        kind: 'tag',
        name,
        didYouMean: nearNames(name, candidatesOf(library, 'tag')).map(each => each.name),
      })
    }
    if (understanding.noTags.length > 0) {
      conditions.push({
        said: `not tagged ${understanding.noTags.join(' or ')}`,
        keep: fitting({ noTags: understanding.noTags }),
      })
    }
  }
  for (const what of ['energy', 'bpm', 'year'] as const) {
    const range = rangeOf(filters[what])
    if (range.min === null && range.max === null) continue
    conditions.push({ said: rangeWords(what, range), keep: fitting({ [what]: range }) })
  }
  if (filters.words) {
    conditions.push({
      said: filters.words === 'with' ? 'with lyrics' : 'without lyrics',
      keep: fitting({ words: filters.words }),
    })
  }
  if (typeof filters.loved === 'boolean') {
    conditions.push({
      said: filters.loved ? 'loved' : 'not loved',
      keep: fitting({ loved: filters.loved }),
    })
  }
  const days = [
    ['playedWithinDays', 'played in the last'],
    ['notPlayedWithinDays', 'not played in the last'],
    ['addedWithinDays', 'added in the last'],
  ] as const
  for (const [key, words] of days) {
    const n = filters[key]
    if (n) conditions.push({ said: `${words} ${n} days`, keep: fitting({ [key]: n }) })
  }

  let kept = [...songs]
  let emptiedBy: string | null = null
  for (const condition of conditions) {
    const before = kept.length
    if (before === 0) break
    kept = condition.keep(kept)
    if (kept.length === 0) {
      emptiedBy = `${condition.said} (left none of ${before})`
      break
    }
  }
  return { songs: kept, emptiedBy, unmatched }
}

/** The handles a request comes with: the model may not name a set of its own after them. */
const RESERVED = /^(playing|screen|t\d+\.\d+)$/

export class WorkingSet {
  readonly #sets = new Map<string, NamedSet>()
  readonly #proposals = new Map<string, Proposal>()
  /** Every id the model has been shown in a row, a set or a result. */
  readonly #allowed = new Set<number>()
  readonly #byId: ReadonlyMap<number, Song>

  constructor(
    readonly library: Library,
    held: Held,
  ) {
    this.#byId = new Map(library.songs.map(song => [song.id, song]))
    if (held.playing) this.#keep(PLAYING, [held.playing], 'the song playing')
    for (const object of held.objects) {
      const songs = scopeOf({ handle: object.handle, picks: null }, held, library.songs) ?? []
      const why = new Map(
        object.songIds.flatMap((id, index) => {
          const said = object.why[index]
          return said ? [[id, said] as const] : []
        }),
      )
      this.#keep(object.handle, songs, object.label, why)
    }
    const screen = held.screen ? this.#sets.get(held.screen) : undefined
    if (screen && held.screen) {
      this.#keep('screen', screen.songs, `on their screen: ${held.screen}`, screen.why)
    }
  }

  #keep(
    name: string,
    songs: readonly Song[],
    label: string,
    why: ReadonlyMap<number, string> = new Map(),
  ): void {
    this.#sets.set(name, { songs, label, why })
    for (const song of songs) this.#allowed.add(song.id)
  }

  /** The sets there are, each with how many songs, for a prompt. */
  listing(): string[] {
    return [...this.#sets].map(
      ([name, set]) =>
        `- ${name}: ${set.songs.length} ${set.songs.length === 1 ? 'song' : 'songs'}, ${set.label}` +
        (set.songs.length === 1 && set.songs[0]
          ? ` (“${set.songs[0].title}” · ${set.songs[0].artist || '-'})`
          : ''),
    )
  }

  has(name: string): boolean {
    return this.#sets.has(name)
  }

  /** A set's songs, in order; an error the model reads when there is no such set. */
  songsOf(name: string): readonly Song[] {
    const set = this.#sets.get(name)
    if (set) return set.songs
    if (name === PLAYING) throw new Error('Nothing is playing, so there is no set called playing.')
    const names = [...this.#sets.keys()]
    throw new Error(
      `There is no set called “${name}”. ${names.length > 0 ? `The sets are: ${names.join(', ')}.` : 'No set has been made yet.'}`,
    )
  }

  /** Songs kept under a name the model chose, in place of any it kept there before. */
  put(
    name: string,
    songs: readonly Song[],
    label: string,
    why?: ReadonlyMap<number, string>,
  ): void {
    if (RESERVED.test(name)) {
      throw new Error(`“${name}” names what the request came with; choose another name.`)
    }
    this.#keep(name, songs, label, why)
  }

  /** Whether the model may name this id: it was shown one, or a set holds it. */
  allowed(id: number): boolean {
    return this.#allowed.has(id) && this.#byId.has(id)
  }

  /** Ids a result showed the model, which it may name from now on. */
  shown(ids: Iterable<number>): void {
    for (const id of ids) if (this.#byId.has(id)) this.#allowed.add(id)
  }

  propose(name: string, proposal: Proposal): void {
    if (RESERVED.test(name)) {
      throw new Error(`“${name}” names what the request came with; choose another name.`)
    }
    this.#proposals.set(name, proposal)
  }

  proposal(name: string): Proposal | undefined {
    return this.#proposals.get(name)
  }

  /**
   * The songs a scope names, in order. A set, or ids it was shown; places
   * count within that list; filters narrow it. Neither a set nor ids: the
   * whole library. Anything it may not name is an error said back to it.
   */
  resolve(scope: ScopeArg | null | undefined): Resolved {
    const all = { songs: [...this.library.songs], emptiedBy: null, unmatched: [] }
    if (!scope) return all
    const ids = scope.ids ?? []
    if (scope.set && ids.length > 0) throw new Error('Give a set or ids, not both.')
    let songs: Song[]
    let from: string
    if (scope.set) {
      songs = [...this.songsOf(scope.set)]
      from = `the set ${scope.set}`
    } else if (ids.length > 0) {
      const strangers = ids.filter(id => !this.allowed(id))
      if (strangers.length > 0) {
        throw new Error(
          `${strangers.slice(0, 10).join(', ')} ${strangers.length === 1 ? 'is not an id' : 'are not ids'} you were shown. Name songs by a set and places in it, or by ids from a tool's result.`,
        )
      }
      songs = ids.flatMap(id => this.#byId.get(id) ?? [])
      from = 'those ids'
    } else {
      songs = [...this.library.songs]
      from = 'the library'
    }
    const places = scope.pick ?? []
    if (places.length > 0) {
      if (!scope.set && ids.length === 0) {
        throw new Error('Places (pick) count within a set or a list of ids: name it too.')
      }
      const past = places.filter(place => place > songs.length)
      if (past.length > 0) {
        throw new Error(
          `${from} holds ${songs.length} ${songs.length === 1 ? 'song' : 'songs'}; there is no place ${past.join(', ')}.`,
        )
      }
      songs = atPlaces(songs, places)
    }
    if (scope.filters) {
      if (songs.length === 0) return { songs, emptiedBy: `${from} holds no songs`, unmatched: [] }
      return applyFilters(songs, scope.filters, this.library)
    }
    return { songs, emptiedBy: songs.length === 0 ? `${from} holds no songs` : null, unmatched: [] }
  }

  /**
   * A set as a tool's answer: its name, how many songs and minutes, and its
   * first rows (`id|title|artist|album|year|tags|energy|len|plays`, then why
   * when a pick said), each id one the model may name from now on.
   */
  view(
    name: string,
    more: {
      readonly offset?: number | null
      readonly emptiedBy?: string | null
      readonly unmatched?: readonly Unmatched[]
      readonly notes?: readonly string[]
    } = {},
  ) {
    const set = this.#sets.get(name)
    const songs = set?.songs ?? []
    const start = Math.max(0, more.offset ?? 0)
    const rows = songs.slice(start, start + ROWS_SHOWN)
    this.shown(rows.map(song => song.id))
    const tagName = new Map(this.library.tags.map(tag => [tag.id, tag.name]))
    const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
    return {
      set: name,
      count: songs.length,
      minutes: Math.round(seconds / 60),
      columns: 'id|title|artist|album|year|tags|energy|len|plays',
      rows: rows.map(song => {
        const why = set?.why.get(song.id)
        return [
          song.id,
          song.title,
          song.artist || '-',
          song.album || '-',
          song.year ?? '-',
          song.tagIds.flatMap(id => tagName.get(id) ?? []).join(',') || '-',
          song.audioFeatures?.energy != null ? song.audioFeatures.energy.toFixed(2) : '-',
          formatDuration(song.duration),
          song.playCount,
          ...(why ? [why] : []),
        ].join('|')
      }),
      ...(start + rows.length < songs.length
        ? { more: songs.length - start - rows.length, nextOffset: start + rows.length }
        : {}),
      ...(more.emptiedBy ? { emptiedBy: more.emptiedBy } : {}),
      ...(more.unmatched && more.unmatched.length > 0 ? { unmatched: more.unmatched } : {}),
      ...(more.notes && more.notes.length > 0 ? { notes: more.notes } : {}),
    }
  }
}
