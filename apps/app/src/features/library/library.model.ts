import { useCallback, useMemo } from 'react'
import { formatLongDuration, type Song, type SongSortField, type Tag } from '@selfmp3/shared'
import {
  clearTagFilter,
  excludeTag,
  filterHeading,
  filterSongs,
  includeTag,
  isDownloaded,
  SORT_OPTIONS,
  tagFilterState,
  tagFiltered,
  usedTags,
  useLibrary,
  type DownloadIndex,
  type LibraryFilter,
  type TagFilterState,
} from '@selfmp3/client'

import { useLibraryFilter } from './libraryFilter'

/**
 * Everything the library screen knows, with nothing it draws.
 *
 * `docs/UNIVERSAL.md` foundation 3: one folder per feature, and the model file
 * imports from `packages/*` and React and nothing else — no `react-native`, no
 * `expo-*`, no component. That is not tidiness for its own sake. It means the
 * rules that decide what a search shows, what "nothing matches" means as
 * opposed to "nothing here yet", and which tags are worth offering can be run
 * by vitest in milliseconds with no simulator and no browser, and it means the
 * screen underneath is a renderer rather than a place where logic hides.
 *
 * The download index is passed in rather than read from a provider, because the
 * provider is native-only and would drag `expo-file-system` in behind it. The
 * screen has one; handing it over costs a line and keeps this file runnable.
 */

export type { LibraryFilter, TagFilterState }

/** What the screen shows when the list is empty, which is three different things. */
export type LibraryEmptyReason = 'unreachable' | 'no-library' | 'no-matches' | null

export interface LibraryModel {
  filter: LibraryFilter
  /** Every song the server knows, unfiltered. */
  songs: readonly Song[]
  /** The songs the filter leaves, in the order they should appear. */
  visible: readonly Song[]
  /** `visible`, as ids — what the player is handed when something is played. */
  songIds: number[]
  /** Only the tags actually in use, which is what the strip offers. */
  tags: readonly Tag[]
  /** The title: "chill · not instrumental", or "Library". */
  heading: string
  /** A tag is filtering, either way. */
  tagFiltered: boolean
  /** The tags being shown only, and being hidden, in the order chosen. */
  includedTags: readonly Tag[]
  excludedTags: readonly Tag[]
  tagFilter: (tagId: number) => TagFilterState
  /** "13 songs · 48 min", or "Loading…" before the first answer. */
  subtitle: string
  sortLabel: string
  sortOptions: typeof SORT_OPTIONS
  loading: boolean
  /** The server did not answer; what is shown is the kept copy. */
  unreachable: boolean
  emptyReason: LibraryEmptyReason
  setQuery: (query: string) => void
  clearQuery: () => void
  setSort: (field: SongSortField) => void
  toggleDirection: () => void
  /** Toggle "only songs with this tag"; stops hiding it if it was hidden. */
  includeTag: (tagId: number) => void
  /** Toggle "hide songs with this tag"; stops showing only it if it was. */
  excludeTag: (tagId: number) => void
  clearTags: () => void
  toggleDownloadedOnly: () => void
}

export function useLibraryModel(downloads: DownloadIndex): LibraryModel {
  const library = useLibrary()
  // Shared with the desktop sidebar, which chooses tags for this list.
  const [filter, setFilter] = useLibraryFilter()

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const allTags = useMemo(() => library.data?.tags ?? [], [library.data])
  const tags = useMemo(() => usedTags(songs, allTags), [songs, allTags])

  const downloaded = useCallback((songId: number) => isDownloaded(downloads, songId), [downloads])
  const visible = useMemo(() => filterSongs(songs, filter, downloaded), [songs, filter, downloaded])
  const songIds = useMemo(() => visible.map(song => song.id), [visible])

  const seconds = useMemo(
    () => visible.reduce((total, song) => total + song.duration, 0),
    [visible],
  )

  const tagsFor = (ids: readonly number[]): Tag[] =>
    ids.flatMap(id => allTags.filter(tag => tag.id === id))

  return {
    filter,
    songs,
    visible,
    songIds,
    tags,
    heading: filterHeading(filter, allTags),
    tagFiltered: tagFiltered(filter),
    includedTags: tagsFor(filter.includedTagIds),
    excludedTags: tagsFor(filter.excludedTagIds),
    tagFilter: tagId => tagFilterState(filter, tagId),
    subtitle: library.isPending
      ? 'Loading…'
      : `${visible.length} ${visible.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(seconds)}`,
    sortLabel: SORT_OPTIONS.find(option => option.field === filter.sort)?.label ?? 'Sort',
    sortOptions: SORT_OPTIONS,
    loading: library.isPending,
    unreachable: library.isError,
    emptyReason: emptyReason({
      isError: library.isError,
      total: songs.length,
      shown: visible.length,
    }),
    setQuery: query => setFilter(current => ({ ...current, query })),
    clearQuery: () => setFilter(current => ({ ...current, query: '' })),
    setSort: sort => setFilter(current => ({ ...current, sort })),
    toggleDirection: () => setFilter(current => ({ ...current, descending: !current.descending })),
    includeTag: tagId => setFilter(current => includeTag(current, tagId)),
    excludeTag: tagId => setFilter(current => excludeTag(current, tagId)),
    clearTags: () => setFilter(clearTagFilter),
    toggleDownloadedOnly: () =>
      setFilter(current => ({ ...current, downloadedOnly: !current.downloadedOnly })),
  }
}

/**
 * Why the list is empty, which the screen turns into a sentence.
 *
 * Three answers rather than one, because they ask the reader to do different
 * things: a library that has never loaded and cannot be reached is a network
 * problem, a library with no songs in it is an invitation to import one, and a
 * filter that matches nothing is the filter's fault. Separated here so the
 * distinction can be tested rather than read off a nested ternary in JSX.
 */
export function emptyReason({
  isError,
  total,
  shown,
}: {
  isError: boolean
  total: number
  shown: number
}): LibraryEmptyReason {
  if (shown > 0) return null
  // An error only explains an empty screen when there is nothing cached to
  // show. With songs in hand, a failed refetch is not what the reader is
  // looking at.
  if (isError && total === 0) return 'unreachable'
  if (total === 0) return 'no-library'
  return 'no-matches'
}
