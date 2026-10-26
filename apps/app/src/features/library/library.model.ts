import { useCallback, useMemo } from 'react'
import { API_ERROR, BUCKET_CAP_CODE, plural } from '@selfmp3/shared'
import type { Song, SongSortField, Tag } from '@selfmp3/shared'
import type { DoormanTrouble } from '@selfmp3/replica'
import type { DevicePlace } from '../settings/settings.model'
import {
  ApiError,
  bothTagsCount,
  clearTagFilter,
  filterHeading,
  filterSongs,
  isDownloaded,
  SORT_OPTIONS,
  tagFiltered,
  type SortOrder,
  toggleTag,
  usedTags,
  useLibrary,
  useSameArray,
  type DownloadIndex,
  type LibraryFilter,
} from '@selfmp3/client'

import { tagsWithIds } from '../lists/lists.model'
import { useLibraryFilter } from './libraryFilter'
import { useLibraryFailure } from './useLibraryFailure'

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
  /** The field and its way round: "Recently added · newest". */
  sortLabel: string
  sortOptions: typeof SORT_OPTIONS
  /** The current field's two ways round, named for it: Newest first, Oldest first. */
  sortOrders: readonly SortOrder[]
  loading: boolean
  /** The server did not answer; what is shown is the kept copy. */
  unreachable: boolean
  /** Why the library did not answer, for the card that says so; null while it has. */
  failure: unknown
  emptyReason: LibraryEmptyReason
  /** Sort by a field, its own way round first. */
  setSort: (field: SongSortField) => void
  setDescending: (descending: boolean) => void
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
   * The actions, made once: a row is handed `toggleTag` for its chips, so a
   * new one each render would redraw every row of the library. `setFilter` is
   * a state setter, so none of these ever needs remaking.
   */
  const setSort = useCallback(
    (sort: SongSortField) =>
      setFilter(current => ({
        ...current,
        sort,
        descending: optionFor(sort)?.orders[0].descending ?? current.descending,
      })),
    [setFilter],
  )
  const setDescending = useCallback(
    (descending: boolean) => setFilter(current => ({ ...current, descending })),
    [setFilter],
  )
  const sortOption = optionFor(filter.sort)
  const toggleTagId = useCallback(
    (tagId: number) => setFilter(current => toggleTag(current, tagId)),
    [setFilter],
  )
  const clearTags = useCallback(() => setFilter(clearTagFilter), [setFilter])
  const toggleDownloadedOnly = useCallback(
    () => setFilter(current => ({ ...current, downloadedOnly: !current.downloadedOnly })),
    [setFilter],
  )

  const { refetch } = library
  // Kept while it is asked for again, rather than "Loading…" in between.
  const error = useLibraryFailure(library)
  const isError = error !== null
  const isPending = library.isPending && !isError
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
      // Nothing to count when the library never came: "0 songs" over the
      // can't-reach card read as an empty library.
      subtitle: isPending
        ? 'Loading…'
        : isError && songs.length === 0
          ? ''
          : songs.length === 0
            ? 'No songs yet'
            : plural(visible.length, 'song', 'songs'),
      matchNote: isPending ? null : matchNote(filter.tagIds.length, allMatched, visible.length),
      sortLabel: orderLabel(sortOption, filter.descending),
      sortOptions: SORT_OPTIONS,
      sortOrders: sortOption?.orders ?? [],
      loading: isPending,
      unreachable: isError,
      failure: error,
      emptyReason: emptyReason({ isError, total: songs.length, shown: visible.length }),
      setSort,
      setDescending,
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
      setDescending,
      sortOption,
      toggleTagId,
      clearTags,
      toggleDownloadedOnly,
    ],
  )
}

const optionFor = (field: SongSortField): (typeof SORT_OPTIONS)[number] | undefined =>
  SORT_OPTIONS.find(option => option.field === field)

/** "Recently added · newest": the field, and which way round it goes. */
export function orderLabel(
  option: (typeof SORT_OPTIONS)[number] | undefined,
  descending: boolean,
): string {
  if (!option) return 'Sort'
  const way = option.orders.find(order => order.descending === descending)
  return way ? `${option.label} · ${way.short}` : option.label
}

/**
 * Whether the library failed because the bucket's daily allowance is used up.
 * Everything answered then — the doorman, the server — so nothing should say
 * it cannot be reached.
 */
/**
 * The doorman's trouble (packages/replica/src/reach.ts) as the error the
 * screens already know how to say: nothing answering as offline, an error of
 * its own as a problem, a write refused for the day as the allowance.
 */
export function troubleAsError(trouble: DoormanTrouble | null): ApiError | null {
  if (trouble === null) return null
  if (trouble.kind === 'unreachable') return new ApiError(0, trouble.message, API_ERROR.offline)
  if (trouble.kind === 'capped') return new ApiError(502, trouble.message, BUCKET_CAP_CODE)
  return new ApiError(502, trouble.message)
}

export function bucketCapped(error: unknown): boolean {
  return error instanceof ApiError && error.isBucketCapped
}

/**
 * "21 hours", "40 minutes" — or, where a line has little room, "21 h", "40 min":
 * how long until Backblaze's caps reset, at midnight GMT.
 */
export function untilCapResets(now: Date, short = false): string {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const minutes = Math.max(1, Math.ceil((reset - now.getTime()) / 60_000))
  if (minutes < 60) return short ? `${minutes} min` : plural(minutes, 'minute', 'minutes')
  const hours = Math.round(minutes / 60)
  return short ? `${hours} h` : plural(hours, 'hour', 'hours')
}

/**
 * Whether the library was reached and answered with an error rather than an
 * answer: a 5xx, a proxy's error page, half an answer, a Wi-Fi sign-in page
 * where the library should be. Not "can't reach": the device is online and
 * something answered, and checking the connection would be the wrong advice.
 */
function answeredWithError(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 500 && !error.isBucketCapped
}

/**
 * The few words for a library that did not come: the profile's line, the
 * settings' status. Where the library lives — a server, a bucket — is for
 * the screens that set it up; everywhere else it is just your library.
 */
export function unreachableLabel(error: unknown): string {
  if (bucketCapped(error)) return 'Storage allowance used up for today'
  if (answeredWithError(error)) return 'Your library ran into a problem'
  return 'Can’t reach your library'
}

/**
 * What a page whose numbers come from the library says while the library is
 * out of reach — Stats, the Report, Profile's month — in one line, so the
 * three say it the same way.
 */
export const SHOWS_WHEN_REACHABLE = 'This shows when your library is reachable again.'

/** The same for lyrics, on a phone's Now Playing and a computer's. */
export const LYRICS_WHEN_REACHABLE = 'Lyrics show when your library is reachable again.'

/**
 * What the "can't reach" card says: that the library did not answer, and
 * what to check.
 *
 * The address is the one this device actually asked, without its scheme, so a
 * reader can see a typo or a stale address at a glance. A cloud library has
 * no address to show. On a phone there is room for one short line, and the
 * address is in Settings, one press away.
 *
 * A used-up storage allowance is not "can't reach" at all: it says so, and
 * for how long, in a title and one line; when it comes back and where to raise
 * it are behind Why? (`why`) — the one place outside its setup where Backblaze
 * is named, because that is where the reader has to go.
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
}): { title: string; body: string; why: string | null } {
  if (bucketCapped(error)) {
    const until = untilCapResets(now)
    return {
      title: 'Storage allowance used up',
      body: `Downloads are paused for about ${until}.`,
      why: `Your storage stopped downloads until its daily allowance resets. Nothing is wrong with your connection. To get your library back now, raise the cap under Caps & Alerts at backblaze.com.`,
    }
  }
  if (answeredWithError(error)) {
    const title = 'Your library ran into a problem'
    return {
      title,
      body: compact
        ? 'It answered with an error. It’s asked again by itself.'
        : 'It answered with an error rather than your library. self.mp3 asks again by itself, or you can try now.',
      why: null,
    }
  }
  const title = 'Can’t reach your library'
  if (compact) return { title, body: 'Check that you’re online, then try again.', why: null }
  if (fromCloud) return { title, body: 'Check that this device is online.', why: null }
  const host = address ? address.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '') : null
  return {
    title,
    body: `${host ? `self.mp3 tried ${host}. ` : ''}Check that this device is online and that the computer your library lives on is switched on.`,
    why: null,
  }
}

/**
 * The card at the foot of a computer's sidebar, when something needs the
 * person: what still works, and what to do. Null on a normal day, when the
 * foot is only the person and a green dot.
 *
 * `held` is the storage refusing reads for the day, known before any read
 * fails (`useBucketHold`); `error` may be it refusing a write, when what
 * waits is the edits. `offline` is the device itself saying it has no network:
 * nothing is even asked then, so no error ever arrives to say so, and the foot
 * kept a green dot and "All saved" over an edit that had not gone. `unsent`
 * counts the edits held back to send later — a cloud library's outbox, or a
 * server library's edits made offline (`waitingEdits.ts`), which go out on
 * their own once it is back. `keepsSongs` is false in a browser tab, which
 * streams and keeps nothing, so it has no songs of its own that would still
 * play.
 */
export function footNotice({
  error,
  held,
  offline = false,
  fromCloud,
  keepsSongs,
  place,
  unsent,
  now = new Date(),
}: {
  /** Why the library did not come; null while it has. */
  error: unknown
  held: boolean
  offline?: boolean
  fromCloud: boolean
  keepsSongs: boolean
  place: DevicePlace
  unsent: number
  now?: Date
}): { title: string; body: string } | null {
  const stillPlay = keepsSongs ? `Songs on this ${place} still play. ` : ''
  if (held || bucketCapped(error)) {
    const until = untilCapResets(now)
    // Reads go on, and an edit could not go up: that is the news.
    if (!held && unsent > 0) {
      return {
        title: 'Storage allowance used up',
        body:
          unsent === 1
            ? `Your change sends when it resets, in about ${until}.`
            : `Your ${unsent} changes send when it resets, in about ${until}.`,
      }
    }
    return {
      title: 'Storage allowance used up',
      body: `${stillPlay}The rest come back in about ${until}.`,
    }
  }
  const changes =
    unsent === 0
      ? 'Changes send when you’re back.'
      : unsent === 1
        ? 'Your change sends when you’re back.'
        : `Your ${unsent} changes send when you’re back.`
  if (offline) return { title: 'Offline', body: `${stillPlay}${changes}` }
  if (!error) return null
  if (answeredWithError(error)) {
    return {
      title: 'Your library ran into a problem',
      body: `${stillPlay}It answered with an error; it’s asked again by itself.`,
    }
  }
  if (!fromCloud) {
    return {
      title: 'Can’t reach your library',
      body: `${stillPlay}Changes can’t be saved until it’s back. Check that you’re online.`,
    }
  }
  return { title: 'Offline', body: `${stillPlay}${changes}` }
}

/**
 * What hovering the foot says on a normal day: that everything is saved,
 * how big the library is, and how much of it is on this device — "All saved
 * · 109 songs · 12 on this computer". A device keeping none leaves the last
 * part off; a browser tab never keeps any.
 */
export function footSummary({
  songs,
  here,
  place,
  unsent = 0,
}: {
  songs: number
  here: number
  place: DevicePlace
  /** Edits not sent yet: never "All saved" over one. */
  unsent?: number
}): string {
  const saved = unsent === 0 ? 'All saved' : `Saving ${plural(unsent, 'change', 'changes')}…`
  const parts = [saved, plural(songs, 'song', 'songs')]
  if (here > 0) parts.push(`${here} on this ${place}`)
  return parts.join(' · ')
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
