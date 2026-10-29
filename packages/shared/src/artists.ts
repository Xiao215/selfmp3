import type { Song } from './schemas/song.js'
import { CJK } from './titles.js'
import { ARTIST_NAMES_MAX } from './schemas/artist.js'

/**
 * Artists, from the songs' own artist strings (docs/UI-MIGRATION.md, Phase 4
 * and Open question 3). Here rather than in the client because the server
 * reads them too, to find an artist's page on YouTube Music through the songs
 * (apps/server services/artistBackdrops.ts).
 *
 * An artist is a place, like a tag, but nobody makes one: it is what the
 * songs say. A string that names several — "A feat. B", "A & B", "A, B",
 * "A × B", "A x B" — names each of them, and a song belongs to every artist
 * it names. Two spellings of one name are one artist when they differ only in
 * case or spacing; "ヨルシカ" and "Yorushika" are two here, and are joined
 * only by an artist's other names (artistJoins.ts), never guessed.
 */

/**
 * What a song with no artist is credited to. The server's Stats and Wrapped
 * count such songs under this name (repositories/listening.ts), so a client
 * comparing a stats key with it must use this one string.
 */
export const UNKNOWN_ARTIST = 'Unknown artist'

/** A song's artist as a line shows it: the string it has, or `UNKNOWN_ARTIST` when it is empty. */
export function artistOr(artist: string | null | undefined): string {
  return artist || UNKNOWN_ARTIST
}

export interface Artist {
  /** The name compared: trimmed, spaces collapsed, lowercased. */
  readonly key: string
  /** The spelling most of its songs use. */
  readonly name: string
  readonly songIds: readonly number[]
  /**
   * Every key a song is matched by: its own, then those of the artists joined
   * to it by its other names (artistJoins.ts), "ヨルシカ" under "Yorushika".
   */
  readonly keys: readonly string[]
  /** The artists joined to it, as their songs spell them, most songs first. */
  readonly joined: readonly string[]
}

/** "(feat. B)" and "[ft. B]": the brackets go, the name stays as one more artist. */
const BRACKETED_GUEST = /\s*[([（]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]）]+)[)\]）]/gi

/** Where a list of names is: a comma (either width), "、" and a semicolon (either width). */
const LIST = /\s*[,，、;；]\s*/

/**
 * Between two names, on top of a list: "&", "×", an " x " standing alone, and
 * the featuring words. A lone "x" needs spaces round it, so "Xiao" and "Sixx"
 * are left whole.
 */
const JOIN = /\s*(?:[,，、;；]|&|＆|×|\s[xX]\s|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i

/**
 * A slash between two names: "A / B", or "周杰伦/费玉清" where either side is
 * Chinese, Japanese or Korean. A slash inside a Latin name ("AC/DC") is part of it.
 */
const SPACED_SLASH = /\s+\/\s+/g
const CJK_SLASH = new RegExp(`(${CJK.source})\\s*/\\s*|\\s*/\\s*(?=${CJK.source})`, 'gu')

/**
 * The names one artist string holds, in the order it gives them, each once.
 *
 * The one splitter for every place that asks who a song is by: the library's
 * artists, Stats and Wrapped, the AI's view of the library, CarPlay. By
 * default every way a credit joins two names splits it ("A feat. B", "A & B",
 * "A、B", "A / B"). `'list'` splits only where the credit is a list (commas,
 * "、", semicolons) and keeps "A & B" and "A feat. B" whole, for the tidy and
 * the metadata check, which rewrite a credit name by name and join it again.
 */
export function splitArtists(artist: string, at: 'names' | 'list' = 'names'): string[] {
  const flat =
    at === 'list'
      ? artist
      : artist
          .replace(BRACKETED_GUEST, ', $1')
          .replace(SPACED_SLASH, ', ')
          .replace(CJK_SLASH, (_, before: string | undefined) => (before ? `${before}, ` : ', '))
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of flat.split(at === 'list' ? LIST : JOIN)) {
    const name = part.replace(/\s+/g, ' ').trim()
    const key = artistKey(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/** Who a song is mostly by: the first name its artist string gives, or `UNKNOWN_ARTIST`. */
export function mainArtist(artist: string): string {
  return splitArtists(artist)[0] ?? UNKNOWN_ARTIST
}

/** "薛之谦, 薛之谦, 薛之谦" → "薛之谦": each name in a list once, the first spelling kept. */
export function withoutRepeats(credit: string): string {
  const names = splitArtists(credit, 'list')
  const written = credit.split(LIST).filter(part => part.trim() !== '')
  return names.length === written.length ? credit : names.join(', ')
}

/** How two spellings are compared: trimmed, spaces collapsed, case ignored. */
export function artistKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Every artist a song names. */
export function songArtistKeys(song: Pick<Song, 'artist'>): string[] {
  return splitArtists(song.artist).map(artistKey)
}

const cache = new WeakMap<readonly Song[], readonly Artist[]>()

/**
 * Every artist in the library, most songs first, then by name. A missing file
 * does not count. Worked out once per songs array, which the library query
 * keeps until it refetches.
 */
export function libraryArtists(songs: readonly Song[]): readonly Artist[] {
  const cached = cache.get(songs)
  if (cached) return cached
  const byKey = new Map<string, { songIds: number[]; spellings: Map<string, number> }>()
  for (const song of songs) {
    for (const name of splitArtists(song.artist)) {
      const key = artistKey(name)
      let entry = byKey.get(key)
      if (!entry) {
        entry = { songIds: [], spellings: new Map() }
        byKey.set(key, entry)
      }
      entry.songIds.push(song.id)
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1)
    }
  }
  const artists = [...byKey].map(([key, entry]) => {
    let name = ''
    let best = 0
    // The first spelling to reach the most songs wins a tie, so the name is stable.
    for (const [spelling, count] of entry.spellings) {
      if (count > best) {
        name = spelling
        best = count
      }
    }
    return { key, name, songIds: entry.songIds, keys: [key], joined: [] }
  })
  artists.sort((a, b) => b.songIds.length - a.songIds.length || a.name.localeCompare(b.name))
  cache.set(songs, artists)
  return artists
}

/**
 * The artist with this name, spelt any way that compares equal, or undefined.
 * In a list of joined artists (`joinedArtists`), the artist it is joined to.
 */
export function findArtist(artists: readonly Artist[], name: string): Artist | undefined {
  const key = artistKey(name)
  return artists.find(artist => artist.keys.includes(key))
}

/**
 * An artist's other names as they are kept: each once, compared as
 * `artistKey` compares, without the artist's own name, in the order given and
 * no more than are kept. The same on the server and on every device, so a list
 * saved anywhere is the same list everywhere.
 */
export function tidyArtistNames(artist: string, names: readonly string[]): string[] {
  const seen = new Set([artistKey(artist)])
  const kept: string[] = []
  for (const name of names) {
    const tidy = name.replace(/\s+/g, ' ').trim()
    const key = artistKey(tidy)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(tidy)
  }
  return kept.slice(0, ARTIST_NAMES_MAX)
}
