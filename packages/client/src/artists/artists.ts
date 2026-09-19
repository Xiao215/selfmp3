import type { Song } from '@selfmp3/shared'

/**
 * Artists, from the songs' own artist strings (docs/UI-MIGRATION.md, Phase 4
 * and Open question 3).
 *
 * An artist is a place, like a tag, but nobody makes one: it is what the
 * songs say. A string that names several — "A feat. B", "A & B", "A, B",
 * "A × B", "A x B" — names each of them, and a song belongs to every artist
 * it names. Two spellings of one name are one artist when they differ only in
 * case or spacing; "ヨルシカ" and "Yorushika" stay two, and joining them is a
 * metadata fix, not something guessed here.
 */

export interface Artist {
  /** The name compared: trimmed, spaces collapsed, lowercased. */
  readonly key: string
  /** The spelling most of its songs use. */
  readonly name: string
  readonly songIds: readonly number[]
}

/** "(feat. B)" and "[ft. B]": the brackets go, the name stays as one more artist. */
const BRACKETED_GUEST = /\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/gi

/**
 * Between two names: a comma, "&", "×", an " x " standing alone, and the
 * featuring words. A lone "x" needs spaces round it, so "Xiao" and "Sixx" are
 * left whole.
 */
const SEPARATOR = /\s*(?:,|&|×|\s[xX]\s|\s(?:feat\.?|ft\.?|featuring)\s)\s*/

/** The names one artist string holds, in the order it gives them. */
export function splitArtists(artist: string): string[] {
  const flat = artist.replace(BRACKETED_GUEST, ', $1')
  const names: string[] = []
  const seen = new Set<string>()
  for (const part of flat.split(SEPARATOR)) {
    const name = part.replace(/\s+/g, ' ').trim()
    const key = artistKey(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
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
    if (song.missing) continue
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
    return { key, name, songIds: entry.songIds }
  })
  artists.sort((a, b) => b.songIds.length - a.songIds.length || a.name.localeCompare(b.name))
  cache.set(songs, artists)
  return artists
}

/** The artist with this name, spelt any way that compares equal, or undefined. */
export function findArtist(songs: readonly Song[], name: string): Artist | undefined {
  const key = artistKey(name)
  return libraryArtists(songs).find(artist => artist.key === key)
}
