import type { Song } from '@selfmp3/shared'
import { libraryIndex, useLibrary, type LibraryIndex } from '@selfmp3/client'

/**
 * The library by song id, built once per library and shared by every reader.
 *
 * Keyed by the songs array itself, which React Query hands back unchanged
 * until the library changes, so a grid of forty playlist covers — or an
 * answer and the review inside it — share one map rather than each building
 * a copy of the whole library every time it draws.
 */
const byIdCache = new WeakMap<readonly Song[], ReadonlyMap<number, Song>>()

const NO_SONGS: readonly Song[] = []

export function songsById(songs: readonly Song[]): ReadonlyMap<number, Song> {
  let byId = byIdCache.get(songs)
  if (!byId) {
    byId = new Map(songs.map(song => [song.id, song]))
    byIdCache.set(songs, byId)
  }
  return byId
}

/** This device's library by song id; empty until the library is here. */
export function useSongsById(): ReadonlyMap<number, Song> {
  const { data: library } = useLibrary()
  return songsById(library?.songs ?? NO_SONGS)
}

const indexCache = new WeakMap<readonly Song[], LibraryIndex>()

/**
 * This device's library by audio file and by source link (`libraryIndex`):
 * which of a room's, a link's or a shared playlist's songs are already yours.
 * Built once per library and shared the same way, so Home's past-room tiles
 * and the pages they open do not each index the whole library.
 */
export function useLibraryIndex(): LibraryIndex {
  const { data: library } = useLibrary()
  const songs = library?.songs ?? NO_SONGS
  let index = indexCache.get(songs)
  if (!index) {
    index = libraryIndex(songs)
    indexCache.set(songs, index)
  }
  return index
}
