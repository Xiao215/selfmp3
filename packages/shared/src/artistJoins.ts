import { artistKey, findArtist, libraryArtists, tidyArtistNames, type Artist } from './artists.js'
import { hlcTime } from './hlc.js'
import { ARTIST_NAMES_MAX } from './schemas/artist.js'
import type { Library } from './schemas/library.js'
import type { Song } from './schemas/song.js'
import { namesFor } from './searchNames.js'

/**
 * One artist under two spellings, as one artist: "Yorushika" (78 songs) and
 * "ヨルシカ" (6) on one page, one row in Search, one entry in Stats and the
 * Report, one artist to Ask.
 *
 * What joins them is an artist's other names (`Library.artistNames`): when
 * an artist's other names hold the name of an artist with fewer songs, that
 * artist is joined to it, and is shown under its name. The songs' own artist
 * fields are never rewritten, so taking the name out again parts them.
 *
 * Only names somebody saved join artists. The names MusicBrainz finds
 * (`Library.artistNamesFound`) still find songs, but a link they make — and
 * a smaller artist naming a bigger one — only asks, on the smaller artist's
 * page, "Same artist as Yorushika?" (`sameArtistAsk`). Joining saves the
 * smaller name among the bigger artist's names; "Not the same" takes the
 * names that linked them out, so the question does not come back.
 *
 * Worked out the same way on the server and on every device, from the songs
 * and the names that travel with the library, so it holds on a phone away
 * from the server too.
 */

export type ArtistJoinNames = Pick<Library, 'artistNames' | 'artistNamesFound'>

export const NO_JOINS: ArtistJoinNames = { artistNames: {}, artistNamesFound: [] }

/**
 * Whether an artist's names, by the stamp they carry, are as MusicBrainz
 * found them: the server stamps what it finds as the earliest change there
 * could be (apps/server services/artistNames.ts), and whatever a person saves
 * carries the time it was saved.
 */
export function namesFound(hlc: string | null | undefined): boolean {
  return hlc != null && hlcTime(hlc) === 0
}

/**
 * Which artists are joined: each joined artist's key → the artist it is
 * joined to, its main. An artist joined to nothing is not in it.
 *
 * `artists` are the library's own (`libraryArtists`), most songs first; an
 * artist is bigger than another when it comes first there. A group's main is
 * its biggest, so the name shown is the one most songs carry.
 */
export function artistJoins(
  artists: readonly Artist[],
  names: ArtistJoinNames,
): Map<string, Artist> {
  const rank = new Map(artists.map((artist, index) => [artist.key, index]))
  const found = new Set(names.artistNamesFound)
  const root = artists.map((_, index) => index)
  const find = (index: number): number => {
    while (root[index] !== index) {
      root[index] = root[root[index]!]!
      index = root[index]!
    }
    return index
  }
  artists.forEach((artist, index) => {
    if (found.has(artist.key)) return
    for (const other of namesFor(names.artistNames, artist.key)) {
      const smaller = rank.get(artistKey(other))
      if (smaller === undefined || smaller <= index) continue
      const [a, b] = [find(index), find(smaller)]
      // The bigger root stays the root: a group's main is its biggest.
      if (a !== b) root[Math.max(a, b)] = Math.min(a, b)
    }
  })
  const joins = new Map<string, Artist>()
  artists.forEach((artist, index) => {
    const main = find(index)
    if (main !== index) joins.set(artist.key, artists[main]!)
  })
  return joins
}

const cache = new WeakMap<
  readonly Song[],
  WeakMap<ArtistJoinNames['artistNames'], readonly Artist[]>
>()

/**
 * Every artist in the library as it is shown: the joined ones as one, under
 * the main's name, with the songs of each (`keys`, `joined`). Most songs
 * first, then by name, as `libraryArtists`. Worked out once per songs and names.
 */
export function joinedArtists(songs: readonly Song[], names: ArtistJoinNames): readonly Artist[] {
  const byNames = cache.get(songs) ?? new WeakMap()
  cache.set(songs, byNames)
  const cached = byNames.get(names.artistNames)
  if (cached) return cached

  const artists = libraryArtists(songs)
  const joins = artistJoins(artists, names)
  let shown: readonly Artist[] = artists
  if (joins.size > 0) {
    const members = new Map<string, Artist[]>()
    for (const artist of artists) {
      const main = joins.get(artist.key) ?? artist
      const group = members.get(main.key) ?? []
      group.push(artist)
      members.set(main.key, group)
    }
    shown = [...members.values()]
      .map(group => {
        const [main, ...joined] = group as [Artist, ...Artist[]]
        if (joined.length === 0) return main
        // A song credited under both spellings counts once.
        const songIds = [...new Set(group.flatMap(artist => artist.songIds))]
        return {
          key: main.key,
          name: main.name,
          songIds,
          keys: group.map(artist => artist.key),
          joined: joined.map(artist => artist.name),
        }
      })
      .sort((a, b) => b.songIds.length - a.songIds.length || a.name.localeCompare(b.name))
  }
  byNames.set(names.artistNames, shown)
  return shown
}

/**
 * Each artist key → the name it is shown under: the main's for a joined
 * artist, and nothing for one joined to nothing. What the server counts
 * Stats and the Report by, where plays come as artist strings rather than songs.
 */
export function joinedNames(songs: readonly Song[], names: ArtistJoinNames): Map<string, string> {
  const shownAs = new Map<string, string>()
  for (const [key, main] of artistJoins(libraryArtists(songs), names)) shownAs.set(key, main.name)
  return shownAs
}

/**
 * The keys a song by this artist is matched by: every spelling joined to the
 * artist it names, or just its own when it is joined to nothing.
 */
export function joinedKeys(songs: readonly Song[], names: ArtistJoinNames, name: string): string[] {
  const artist = findArtist(joinedArtists(songs, names), name)
  return artist ? [...artist.keys] : [artistKey(name)]
}

/** The question on a smaller artist's page: whether it is the same artist as a bigger one. */
export interface SameArtistAsk {
  /** The artist the page is about. */
  readonly artist: Artist
  /** The bigger artist it may be, as shown (joined), whose name is asked about. */
  readonly other: Artist
  /** `PUT /api/artists/names` for "Join them": the smaller name saved among the bigger's. */
  readonly join: { readonly artist: string; readonly names: string[] }
  /** The same for "Not the same": each list that linked them, without the other's names. */
  readonly apart: readonly { readonly artist: string; readonly names: string[] }[]
}

/**
 * Whether the page of `artist` (as shown, from `joinedArtists`) asks if it is
 * the same artist as a bigger one: when its own names hold a bigger artist's
 * name, or a bigger artist's names as MusicBrainz found them hold its name,
 * and nothing joins them yet. The biggest such artist is asked about; null
 * when there is none.
 */
export function sameArtistAsk(
  songs: readonly Song[],
  names: ArtistJoinNames,
  artist: Artist,
): SameArtistAsk | null {
  const own = libraryArtists(songs)
  const rank = new Map(own.map((each, index) => [each.key, index]))
  const shown = joinedArtists(songs, names)
  const shownOf = new Map<string, Artist>()
  for (const each of shown) for (const key of each.keys) shownOf.set(key, each)
  const found = new Set(names.artistNamesFound)
  const here = rank.get(artist.key)
  if (here === undefined) return null

  const mine = new Set(artist.keys)
  const named = (key: string): Set<string> =>
    new Set(namesFor(names.artistNames, key).map(artistKey))
  const linked = (other: Artist): boolean => {
    if (other.keys.some(key => artist.keys.some(each => named(each).has(key)))) return true
    return other.keys.some(key => found.has(key) && artist.keys.some(each => named(key).has(each)))
  }

  for (const candidate of own.slice(0, here)) {
    if (mine.has(candidate.key)) continue
    const other = shownOf.get(candidate.key)
    if (!other || !linked(other)) continue

    const kept = namesFor(names.artistNames, other.key)
    const join = {
      artist: other.name,
      names: tidyArtistNames(
        other.name,
        // A full list makes room at the front rather than losing the name.
        kept.length >= ARTIST_NAMES_MAX ? [artist.name, ...kept] : [...kept, artist.name],
      ),
    }
    const apart: { artist: string; names: string[] }[] = []
    const without = (key: string, name: string, away: ReadonlySet<string>): void => {
      const list = namesFor(names.artistNames, key)
      const left = list.filter(each => !away.has(artistKey(each)))
      if (left.length !== list.length) apart.push({ artist: name, names: [...left] })
    }
    const theirs = new Set(other.keys)
    for (const key of artist.keys) without(key, nameOf(own, key), theirs)
    for (const key of other.keys) if (found.has(key)) without(key, nameOf(own, key), mine)
    return { artist, other, join, apart }
  }
  return null
}

function nameOf(artists: readonly Artist[], key: string): string {
  return artists.find(artist => artist.key === key)?.name ?? key
}
