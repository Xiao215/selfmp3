import {
  fuzzyRankPrepared,
  fuzzyTopPrepared,
  preparedTextFor,
  sortSongs,
  type FuzzyMatch,
  type Song,
  type SongSortField,
  type Tag,
} from '@selfmp3/shared'

/**
 * Library filtering and sorting.
 *
 * Pure, and built on the shared `fuzzyRank` so a search that matches on the
 * Mac matches the same way on the phone — the whole reason those helpers live
 * in `packages/shared` rather than in the web app.
 */

export interface LibraryFilter {
  readonly query: string
  /**
   * A song must carry every one of these: "chinese" and "chill" means both,
   * not either. Kept in the order they were chosen, which is the order the
   * heading names them in.
   */
  readonly includedTagIds: readonly number[]
  /** A song carrying any of these is hidden: "chill, but not instrumental". */
  readonly excludedTagIds: readonly number[]
  readonly sort: SongSortField
  readonly descending: boolean
  readonly downloadedOnly: boolean
}

/** The web's opening view: newest first. */
export const DEFAULT_FILTER: LibraryFilter = {
  query: '',
  includedTagIds: [],
  excludedTagIds: [],
  sort: 'addedAt',
  descending: true,
  downloadedOnly: false,
}

/** How one tag is filtering the library right now. */
export type TagFilterState = 'off' | 'include' | 'exclude'

/**
 * The part of a filter the tags decide. The sidebar reads only this, so it
 * need not hear about every letter typed into the search.
 */
export type TagFilter = Pick<LibraryFilter, 'includedTagIds' | 'excludedTagIds'>

export function tagFilterState(filter: TagFilter, tagId: number): TagFilterState {
  if (filter.includedTagIds.includes(tagId)) return 'include'
  if (filter.excludedTagIds.includes(tagId)) return 'exclude'
  return 'off'
}

/** Whether any tag is filtering, either way. */
export function tagFiltered(filter: TagFilter): boolean {
  return filter.includedTagIds.length > 0 || filter.excludedTagIds.length > 0
}

const toggled = (ids: readonly number[], id: number): number[] =>
  ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]

/**
 * Toggle "only songs with this tag". A tag cannot be both shown and hidden, so
 * including one that was excluded stops excluding it — the web app's rule.
 */
export function includeTag(filter: LibraryFilter, tagId: number): LibraryFilter {
  return {
    ...filter,
    includedTagIds: toggled(filter.includedTagIds, tagId),
    excludedTagIds: filter.excludedTagIds.filter(id => id !== tagId),
  }
}

/** Toggle "hide songs with this tag", the other side of the same rule. */
export function excludeTag(filter: LibraryFilter, tagId: number): LibraryFilter {
  return {
    ...filter,
    excludedTagIds: toggled(filter.excludedTagIds, tagId),
    includedTagIds: filter.includedTagIds.filter(id => id !== tagId),
  }
}

export function clearTagFilter(filter: LibraryFilter): LibraryFilter {
  return tagFiltered(filter) ? { ...filter, includedTagIds: [], excludedTagIds: [] } : filter
}

/**
 * The title a filtered library carries: "chill · not instrumental", or with
 * only exclusions, "Library · not instrumental". A tag that no longer exists
 * is left out rather than named as nothing.
 */
export function filterHeading(
  filter: LibraryFilter,
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): string {
  if (!tagFiltered(filter)) return 'Library'
  const nameOf = (id: number): string | undefined => tags.find(tag => tag.id === id)?.name
  const parts = [
    ...(filter.includedTagIds.length === 0 ? ['Library'] : []),
    ...filter.includedTagIds.map(nameOf),
    ...filter.excludedTagIds.map(id => {
      const name = nameOf(id)
      return name === undefined ? undefined : `not ${name}`
    }),
  ].filter((part): part is string => part !== undefined)
  return parts.length > 0 ? parts.join(' · ') : 'Library'
}

/** Sort options offered in the UI — the web's list, in the web's order. */
export const SORT_OPTIONS: { field: SongSortField; label: string }[] = [
  { field: 'addedAt', label: 'Recently added' },
  { field: 'title', label: 'Title' },
  { field: 'artist', label: 'Artist' },
  { field: 'album', label: 'Album' },
  { field: 'duration', label: 'Length' },
  { field: 'playCount', label: 'Most played' },
  { field: 'lastPlayedAt', label: 'Recently played' },
]

function searchText(song: Song): string {
  return `${song.title} ${song.artist} ${song.album}`
}

/**
 * Each song's search text, lowercased once per song object rather than once
 * per keystroke. The library query hands back the same objects until it is
 * refetched, so typing reuses them; a refetch brings new objects and the old
 * text goes with the old songs.
 */
const preparedSearchText = preparedTextFor<Song>(searchText)

/**
 * Songs best-first for a query: the library's search, and the palette's.
 * One matcher and one prepared text for both, so they cannot disagree.
 */
export function searchSongs<S extends Song>(query: string, songs: readonly S[]): FuzzyMatch<S>[] {
  return fuzzyRankPrepared(query, songs, preparedSearchText)
}

/** The best `count` of `searchSongs`, in its order, without ranking the rest. */
export function topSongs<S extends Song>(query: string, songs: readonly S[], count: number): S[] {
  return fuzzyTopPrepared(query, songs, preparedSearchText, count).map(match => match.item)
}

export function filterSongs(
  songs: readonly Song[],
  filter: LibraryFilter,
  isDownloaded: (songId: number) => boolean,
): Song[] {
  let result = songs.filter(song => !song.missing)

  if (tagFiltered(filter)) {
    result = result.filter(
      song =>
        filter.includedTagIds.every(id => song.tagIds.includes(id)) &&
        !filter.excludedTagIds.some(id => song.tagIds.includes(id)),
    )
  }
  if (filter.downloadedOnly) result = result.filter(song => isDownloaded(song.id))

  if (filter.query.trim().length > 0) {
    // A relevance-ranked search should not then be re-sorted by title; the
    // ranking *is* the order.
    return searchSongs(filter.query, result).map(match => match.item)
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
