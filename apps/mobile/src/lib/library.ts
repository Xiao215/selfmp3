import { fuzzyRank, sortSongs, type Song, type SongSortField, type Tag } from '@selfmp3/shared'

/**
 * Library filtering and sorting.
 *
 * Pure, and built on the shared `fuzzyRank` so a search that matches on the
 * Mac matches the same way on the phone — the whole reason those helpers live
 * in `packages/shared` rather than in the web app.
 */

export interface LibraryFilter {
  readonly query: string
  readonly tagId: number | null
  readonly sort: SongSortField
  readonly descending: boolean
  readonly downloadedOnly: boolean
}

export const DEFAULT_FILTER: LibraryFilter = {
  query: '',
  tagId: null,
  sort: 'title',
  descending: false,
  downloadedOnly: false,
}

/** Sort options offered in the UI, in the order they appear. */
export const SORT_OPTIONS: { field: SongSortField; label: string }[] = [
  { field: 'title', label: 'Title' },
  { field: 'artist', label: 'Artist' },
  { field: 'album', label: 'Album' },
  { field: 'addedAt', label: 'Added' },
  { field: 'playCount', label: 'Plays' },
  { field: 'duration', label: 'Length' },
]

function searchText(song: Song): string {
  return `${song.title} ${song.artist} ${song.album}`
}

export function filterSongs(
  songs: readonly Song[],
  filter: LibraryFilter,
  isDownloaded: (songId: number) => boolean,
): Song[] {
  let result = songs.filter(song => !song.missing)

  const tagId = filter.tagId
  if (tagId !== null) result = result.filter(song => song.tagIds.includes(tagId))
  if (filter.downloadedOnly) result = result.filter(song => isDownloaded(song.id))

  if (filter.query.trim().length > 0) {
    // A relevance-ranked search should not then be re-sorted by title; the
    // ranking *is* the order.
    return fuzzyRank(filter.query, result, searchText).map(match => match.item)
  }

  // The shared comparison, so the phone and the Mac put the same library in
  // the same order. A local copy drifted from the web app's in four places.
  return sortSongs(result, filter.sort, filter.descending)
}

/** Tags that are actually used, so the filter row is not full of dead chips. */
export function usedTags(songs: readonly Song[], tags: readonly Tag[]): Tag[] {
  const used = new Set<number>()
  for (const song of songs) for (const id of song.tagIds) used.add(id)
  return tags.filter(tag => used.has(tag.id))
}
