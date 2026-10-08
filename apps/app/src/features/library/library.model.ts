import { useCallback, useMemo } from 'react'
import { plural } from '@selfmp3/shared'
import type { Song, SongSortField, Tag } from '@selfmp3/shared'
import {
  ApiError,
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
  useSameArray,
  type DownloadIndex,
  type LibraryFilter,
} from '@selfmp3/client'

import { tagsWithIds } from '../lists/lists.model'
import { useLibraryFilter } from './libraryFilter'

/**
 * Everything the library screen knows, with nothing it draws.
 *
 * `docs/ARCHITECTURE.md` foundation 3: one folder per feature, and the model file
 * imports from `packages/*` and React and nothing else — no `react-native`, no
 * `expo-*`, no component. That is not tidiness for its own sake. It means the
 * rules that decide what the tags narrow the list to, what "nothing matches" means as
 * opposed to "nothing here yet", and which tags are worth offering can be run
 * by vitest in milliseconds with no simulator and no browser, and it means the
 * screen underneath is a renderer rather than a place where logic hides.
 *
 * The download index is passed in rather than read from a provider, because the
 * provider is native-only and would drag `expo-file-system` in behind it. The
 * screen has one; handing it over costs a line and keeps this file runnable.
 */

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
  /** The title: "chill · 中文", or "Library". Also the name a saved playlist takes. */
  heading: string
  /** At least one tag is chosen. */
  tagFiltered: boolean
  /** The chosen tags, in the order they were chosen — the head's chips. */
  chosenTags: readonly Tag[]
  /** "13 songs", or "Loading…" before the first answer. */
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
  /** Why the library did not answer, for the card that says so; null while it has. */
  failure: unknown
  emptyReason: LibraryEmptyReason
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
  // Kept above the screen, so the strip and the order are still set on coming back.
  const [filter, setFilter] = useLibraryFilter()

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const allTags = useMemo(() => library.data?.tags ?? [], [library.data])
  const tags = useMemo(() => usedTags(songs, allTags), [songs, allTags])

  const downloaded = useCallback((songId: number) => isDownloaded(downloads, songId), [downloads])
  // Kept as the same array while the same songs are in the same order, so a
  // like — which remakes `songs` with one song replaced — does not remake the
  // ids, the selection and every row handler that hangs off them.
  const visible = useSameArray(
    useMemo(() => filterSongs(songs, filter, downloaded), [songs, filter, downloaded]),
  )
  const songIds = useMemo(() => visible.map(song => song.id), [visible])

  const chosenTags = useMemo(() => tagsWithIds(filter.tagIds, allTags), [allTags, filter.tagIds])
  const allMatched = useMemo(() => bothTagsCount(visible, filter.tagIds), [visible, filter.tagIds])

  /*
   * The actions, made once. They were arrows in the object below, new on
   * every render, and a row is handed `toggleTag` for its chips: every row
   * of the library redrew whenever the screen did, whatever had changed.
   * `setFilter` is a state setter, so none of these ever needs remaking.
   */
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

  const { isPending, isError, error, refetch } = library
  const retry = useCallback(() => void refetch(), [refetch])
  return useMemo(
    () => ({
      filter,
      songs,
      visible,
      songIds,
      tags,
      heading: filterHeading(filter, allTags),
      tagFiltered: tagFiltered(filter),
      chosenTags,
      subtitle: isPending ? 'Loading…' : `${plural(visible.length, 'song', 'songs')}`,
      matchNote: isPending ? null : matchNote(filter.tagIds.length, allMatched, visible.length),
      sortLabel: SORT_OPTIONS.find(option => option.field === filter.sort)?.label ?? 'Sort',
      sortOptions: SORT_OPTIONS,
      loading: isPending,
      unreachable: isError,
      failure: error,
      emptyReason: emptyReason({ isError, total: songs.length, shown: visible.length }),
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
      allTags,
      chosenTags,
      allMatched,
      isPending,
      isError,
      error,
      setSort,
      toggleDirection,
      toggleTagId,
      clearTags,
      toggleDownloadedOnly,
    ],
  )
}

/** Backblaze's Caps & Alerts page, where the daily allowance is raised. */
export const BACKBLAZE_CAPS_URL = 'https://secure.backblaze.com/b2_caps_alerts.htm'

/**
 * Whether the library failed because the bucket's daily allowance is used up.
 * Everything answered then — the doorman, the server — so nothing should say
 * it cannot be reached.
 */
export function bucketCapped(error: unknown): boolean {
  return error instanceof ApiError && error.isBucketCapped
}

/** "21 hours", "40 minutes": how long until Backblaze's caps reset, at midnight GMT. */
export function untilCapResets(now: Date): string {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const minutes = Math.max(1, Math.ceil((reset - now.getTime()) / 60_000))
  return minutes < 60
    ? plural(minutes, 'minute', 'minutes')
    : plural(Math.round(minutes / 60), 'hour', 'hours')
}

/** The few words for a library that did not come: the sidebar's status, the profile's line. */
export function unreachableLabel(fromCloud: boolean, error: unknown): string {
  if (bucketCapped(error)) return 'Bucket limit reached for today'
  return fromCloud ? 'Can’t reach the cloud' : 'Can’t reach your server'
}

/**
 * What the "can't reach" card says: which thing did not answer, and what to
 * check.
 *
 * The address is the one this device actually asked, without its scheme, so a
 * reader can see a typo or a stale address at a glance. A cloud library names
 * the cloud and no address. On a phone there is room for one short line, and
 * the address is in Settings, one press away.
 *
 * A used-up bucket allowance is not "can't reach" at all: it says so, when it
 * comes back, and where to raise it.
 */
export function unreachableCopy({
  fromCloud,
  address,
  compact,
  error = null,
  now = new Date(),
}: {
  fromCloud: boolean
  address: string | null
  compact: boolean
  error?: unknown
  now?: Date
}): { title: string; body: string } {
  if (bucketCapped(error)) {
    const until = untilCapResets(now)
    return {
      title: 'Your bucket’s daily limit is used up',
      body: compact
        ? `Backblaze’s cap resets in about ${until}, or raise it at backblaze.com.`
        : `Backblaze stopped downloads from your bucket until its daily cap resets, in about ${until}. Nothing is wrong with your connection. To get your library back now, raise the cap under Caps & Alerts at backblaze.com.`,
    }
  }
  const where = fromCloud ? 'the cloud' : 'your server'
  const title = `Can’t reach ${where}`
  if (compact) {
    return {
      title,
      body: fromCloud
        ? 'Check that you’re online, then try again.'
        : 'Check that it’s on, then try again.',
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

/** The heading over a filter that matched nothing: search has its own page and its own words. */
export function noMatchesTitle(tagFiltered: boolean): string {
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

/** How many tags the strip holds before the + that searches every tag. */
const STRIP_TAGS = 24

/**
 * The tags in Library's strip (docs/ui-mock `P12`): the ones turned on first,
 * so a filter is never hidden off the end, then the ones used lately, then
 * the ones with the most songs. A tag with no songs has nothing to narrow to
 * and is left for the full search.
 */
export function stripTags(
  tags: readonly Tag[],
  chosenIds: readonly number[],
  recentIds: readonly number[],
  limit: number = STRIP_TAGS,
): Tag[] {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const out: Tag[] = []
  const seen = new Set<number>()
  const take = (tag: Tag | undefined): void => {
    if (!tag || seen.has(tag.id)) return
    seen.add(tag.id)
    out.push(tag)
  }
  for (const id of chosenIds) take(byId.get(id))
  for (const id of recentIds) {
    const tag = byId.get(id)
    if (tag && tag.songCount > 0) take(tag)
  }
  const rest = tags
    .filter(tag => tag.songCount > 0 && !seen.has(tag.id))
    .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
  for (const tag of rest) take(tag)
  return out.slice(0, Math.max(limit, chosenIds.length))
}
