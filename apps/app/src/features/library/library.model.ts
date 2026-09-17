import { useCallback, useMemo } from 'react'
import { formatLongDuration, type Song, type SongSortField, type Tag } from '@selfmp3/shared'
import {
  bothTagsCount,
  clearTagFilter,
  filterHeading,
  filterSongs,
  isDownloaded,
  SORT_OPTIONS,
  tagFiltered,
  toggleTag,
  usedTags,
  useLibrary,
  type DownloadIndex,
  type LibraryFilter,
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

export type { LibraryFilter }

/** What the screen shows when the list is empty, which is three different things. */
type LibraryEmptyReason = 'unreachable' | 'no-library' | 'no-matches' | null

interface LibraryModel {
  filter: LibraryFilter
  /** Every song the server knows, unfiltered. */
  songs: readonly Song[]
  /** The songs the filter leaves, in the order they should appear. */
  visible: readonly Song[]
  /** `visible`, as ids — what the player is handed when something is played. */
  songIds: number[]
  /** Only the tags actually in use, which is what the strip offers. */
  tags: readonly Tag[]
  /** A song's tags, the same array for the same song until the tags change, so a row's memo holds. */
  songTags: (song: Song) => readonly Tag[]
  /** The title: "chill · 中文", or "Library". Also the name a saved playlist takes. */
  heading: string
  /** At least one tag is chosen. */
  tagFiltered: boolean
  /** The chosen tags, in the order they were chosen — the head's chips. */
  chosenTags: readonly Tag[]
  /** "13 songs · 48 min", or "Loading…" before the first answer. */
  subtitle: string
  /**
   * "62 have both tags, and come first" — only with two or more tags on, and
   * only when the songs carrying all of them are some but not all of the list.
   */
  matchNote: string | null
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
  /** Turn a tag on or off. Every chosen tag adds its songs to the list. */
  toggleTag: (tagId: number) => void
  clearTags: () => void
  toggleDownloadedOnly: () => void
  /** Ask the server for the library again, after it did not answer. */
  retry: () => void
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

  const songTags = useMemo(() => songTagLookup(allTags), [allTags])
  const chosenTags = useMemo(() => tagsFor(allTags, filter.tagIds), [allTags, filter.tagIds])
  const allMatched = useMemo(() => bothTagsCount(visible, filter.tagIds), [visible, filter.tagIds])

  /*
   * The actions, made once. They were arrows in the object below, new on
   * every render, and a row is handed `toggleTag` for its chips: every row
   * of the library redrew whenever the screen did, whatever had changed.
   * `setFilter` is a state setter, so none of these ever needs remaking.
   */
  const setQuery = useCallback(
    (query: string) => setFilter(current => ({ ...current, query })),
    [setFilter],
  )
  const clearQuery = useCallback(() => setFilter(current => ({ ...current, query: '' })), [setFilter])
  const setSort = useCallback(
    (sort: SongSortField) => setFilter(current => ({ ...current, sort })),
    [setFilter],
  )
  const toggleDirection = useCallback(
    () => setFilter(current => ({ ...current, descending: !current.descending })),
    [setFilter],
  )
  const toggleTagId = useCallback(
    (tagId: number) => setFilter(current => toggleTag(current, tagId)),
    [setFilter],
  )
  const clearTags = useCallback(() => setFilter(clearTagFilter), [setFilter])
  const toggleDownloadedOnly = useCallback(
    () => setFilter(current => ({ ...current, downloadedOnly: !current.downloadedOnly })),
    [setFilter],
  )

  const { isPending, isError, refetch } = library
  const retry = useCallback(() => void refetch(), [refetch])
  return useMemo(
    () => ({
      filter,
      songs,
      visible,
      songIds,
      tags,
      songTags,
      heading: filterHeading(filter, allTags),
      tagFiltered: tagFiltered(filter),
      chosenTags,
      subtitle: isPending
        ? 'Loading…'
        : `${visible.length} ${visible.length === 1 ? 'song' : 'songs'} · ${formatLongDuration(seconds)}`,
      matchNote: isPending ? null : matchNote(filter.tagIds.length, allMatched, visible.length),
      sortLabel: SORT_OPTIONS.find(option => option.field === filter.sort)?.label ?? 'Sort',
      sortOptions: SORT_OPTIONS,
      loading: isPending,
      unreachable: isError,
      emptyReason: emptyReason({ isError, total: songs.length, shown: visible.length }),
      setQuery,
      clearQuery,
      setSort,
      toggleDirection,
      toggleTag: toggleTagId,
      clearTags,
      toggleDownloadedOnly,
      retry,
    }),
    [
      retry,
      filter,
      songs,
      visible,
      songIds,
      tags,
      songTags,
      allTags,
      chosenTags,
      allMatched,
      isPending,
      isError,
      seconds,
      setQuery,
      clearQuery,
      setSort,
      toggleDirection,
      toggleTagId,
      clearTags,
      toggleDownloadedOnly,
    ],
  )
}

/** The tags with these ids, in the order of the ids. */
function tagsFor(allTags: readonly Tag[], ids: readonly number[]): Tag[] {
  return ids.flatMap(id => allTags.filter(tag => tag.id === id))
}

const NO_TAGS: readonly never[] = []

/**
 * Each song's tags, looked up once per song and then kept.
 *
 * A row is memoised, and a fresh array of the same tags is a changed prop:
 * building the list in the render redrew every row each time. Kept by the
 * song object, so a song that did not change — every one but the song just
 * loved, after a love — keeps its array, and a library refetch that hands the
 * same songs back (React Query keeps unchanged objects) keeps them all.
 */
export function songTagLookup<T extends { readonly id: number }>(
  allTags: readonly T[],
): (song: { readonly tagIds: readonly number[] }) => readonly T[] {
  const byId = new Map(allTags.map(tag => [tag.id, tag]))
  const made = new WeakMap<object, readonly T[]>()
  return song => {
    if (song.tagIds.length === 0) return NO_TAGS
    let found = made.get(song)
    if (!found) {
      found = song.tagIds.flatMap(id => {
        const tag = byId.get(id)
        return tag ? [tag] : []
      })
      made.set(song, found)
    }
    return found
  }
}

/**
 * What the "can't reach" card says: which thing did not answer, and what to
 * check.
 *
 * The address is the one this device actually asked, without its scheme, so a
 * reader can see a typo or a stale address at a glance. A cloud library names
 * the cloud and no address. On a phone there is room for one short line, and
 * the address is in Settings, one press away.
 */
export function unreachableCopy({
  fromCloud,
  address,
  compact,
}: {
  fromCloud: boolean
  address: string | null
  compact: boolean
}): { title: string; body: string } {
  const where = fromCloud ? 'the cloud' : 'your server'
  const title = `Can’t reach ${where}`
  if (compact) {
    return {
      title,
      body: fromCloud ? 'Check that you’re online, then try again.' : 'Check that it’s on, then try again.',
    }
  }
  if (fromCloud) {
    return { title, body: 'self.mp3 tried the cloud. Check that this device is online.' }
  }
  const host = address ? address.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '') : null
  return {
    title,
    body: `${host ? `self.mp3 tried ${host}. ` : ''}Check that the server is on and this device is on the same network.`,
  }
}

/**
 * The line under a tagged library that explains the union: "62 have both tags,
 * and come first".
 *
 * Several tags mean *any* of them, which is the one rule here anybody could
 * get wrong — tapping "chill" and "中文" looks like a request for the songs
 * that are both. They are still there, and they are at the top; this says so
 * rather than leaving a longer-than-expected list unexplained.
 *
 * Nothing is said when every song carries every tag (there is no distinction
 * to draw) or when none does (there is nothing at the top to point at).
 */
export function matchNote(tagCount: number, allMatched: number, shown: number): string | null {
  if (tagCount < 2 || allMatched === 0 || allMatched === shown) return null
  const what = tagCount === 2 ? 'both tags' : `all ${tagCount} tags`
  return `${allMatched} have ${what}, and come first`
}

/**
 * The heading over a search or filter that matched nothing: the query itself,
 * in quotes, so a typo is visible where the songs would have been.
 */
export function noMatchesTitle(query: string, tagFiltered: boolean): string {
  const trimmed = query.trim()
  if (trimmed) return `Nothing matches “${trimmed}”`
  return tagFiltered ? 'Nothing matches these tags' : 'Nothing matches'
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
