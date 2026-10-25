import {
  NO_NAMES,
  fuzzyRankPrepared,
  preparedNamesFor,
  songSearchNames,
  sortSongs,
  type LibraryNames,
  type FuzzyMatch,
  type Song,
  type SongSortField,
  type Tag,
} from '@selfmp3/shared'

/**
 * Library filtering and sorting.
 *
 * Pure, and built on the shared `fuzzyRank` so a search that matches on the
 * desktop matches the same way on the phone — the whole reason those helpers live
 * in `packages/shared` rather than in a client.
 */

export interface LibraryFilter {
  /**
   * A song carrying *any* of these is shown: "chill" and "chinese" means both
   * kinds of song, not only the songs that are both. Each tag you add makes
   * the list longer, which is what lets a run of taps be a mood rather than a
   * search that can be narrowed down to nothing.
   *
   * Kept in the order they were chosen, which is the order the heading names
   * them in.
   */
  readonly tagIds: readonly number[]
  readonly sort: SongSortField
  readonly descending: boolean
  readonly downloadedOnly: boolean
}

/** The app's opening view: newest first. */
export const DEFAULT_FILTER: LibraryFilter = {
  tagIds: [],
  sort: 'addedAt',
  descending: true,
  downloadedOnly: false,
}

/**
 * The part of a filter the tags decide. The sidebar reads only this, so it
 * need not hear about every letter typed into the search.
 */
type TagFilter = Pick<LibraryFilter, 'tagIds'>

/** Whether any tag is narrowing the library. */
export function tagFiltered(filter: TagFilter): boolean {
  return filter.tagIds.length > 0
}

/**
 * Turn a tag on or off. There is no third state: a tag is one of the things
 * you want to hear, or it is not.
 */
export function toggleTag(filter: LibraryFilter, tagId: number): LibraryFilter {
  return {
    ...filter,
    tagIds: filter.tagIds.includes(tagId)
      ? filter.tagIds.filter(id => id !== tagId)
      : [...filter.tagIds, tagId],
  }
}

export function clearTagFilter(filter: LibraryFilter): LibraryFilter {
  return tagFiltered(filter) ? { ...filter, tagIds: [] } : filter
}

/**
 * The title a tagged library carries: "chill · 中文", or "Library" with no
 * tags on. It is also the name a playlist saved from these tags is given, so
 * it has to read as a name and not as a description of a query.
 *
 * A tag that no longer exists is left out rather than named as nothing.
 */
export function filterHeading(
  filter: TagFilter,
  tags: readonly Pick<Tag, 'id' | 'name'>[],
): string {
  const names = filter.tagIds
    .map(id => tags.find(tag => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)
  return names.length > 0 ? names.join(' · ') : 'Library'
}

/**
 * How many of the chosen tags this song carries — 0 when none, and the whole
 * count when it carries every one. What orders a tagged library: the songs
 * that are most of what you asked for come first.
 */
export function tagMatchCount(song: Pick<Song, 'tagIds'>, tagIds: readonly number[]): number {
  let matched = 0
  for (const id of tagIds) if (song.tagIds.includes(id)) matched += 1
  return matched
}

/** One way round a sort goes, named for its field: "Newest first", and "newest" beside the field. */
export interface SortOrder {
  readonly descending: boolean
  readonly label: string
  readonly short: string
}

const order = (descending: boolean, label: string, short = label.toLowerCase()): SortOrder => ({
  descending,
  label,
  short,
})

const BY_NAME = [order(false, 'A–Z', 'A–Z'), order(true, 'Z–A', 'Z–A')] as const

/**
 * Sort options offered in the UI — the app's list, in the app's order — each
 * with its two ways round, named for the field rather than as an arrow. The
 * first is the field's own: what choosing the field starts on.
 */
export const SORT_OPTIONS: {
  field: SongSortField
  label: string
  orders: readonly [SortOrder, SortOrder]
}[] = [
  {
    field: 'addedAt',
    label: 'Recently added',
    orders: [order(true, 'Newest first', 'newest'), order(false, 'Oldest first', 'oldest')],
  },
  { field: 'title', label: 'Title', orders: BY_NAME },
  { field: 'artist', label: 'Artist', orders: BY_NAME },
  { field: 'album', label: 'Album', orders: BY_NAME },
  {
    field: 'duration',
    label: 'Length',
    orders: [order(true, 'Longest'), order(false, 'Shortest')],
  },
  {
    field: 'playCount',
    label: 'Most played',
    orders: [order(true, 'Most'), order(false, 'Fewest')],
  },
  {
    field: 'lastPlayedAt',
    label: 'Recently played',
    orders: [order(true, 'Newest'), order(false, 'Oldest')],
  },
]

type PreparedNames = ReturnType<typeof preparedNamesFor<Song>>

/**
 * Each song's names, lowercased once per song object rather than once per
 * keystroke, and once per set of the library's other names
 * (`songSearchNames`).
 *
 * Kept by the other names themselves — the artists' names and the spellings —
 * not by whatever object carries them, which is usually the whole library:
 * a refetch hands back a new library whenever any song changed, but the
 * query's structural sharing keeps every unchanged song, and these two
 * records when nothing in them changed, as the objects they were. So the
 * songs a refetch did not touch keep their prepared names, and a song that
 * changed is a new object and is prepared again.
 */
const preparedByNames = new WeakMap<
  LibraryNames['artistNames'],
  WeakMap<LibraryNames['spellings'], PreparedNames>
>()

function preparedNames({ artistNames, spellings }: LibraryNames): PreparedNames {
  let bySpellings = preparedByNames.get(artistNames)
  if (!bySpellings) {
    bySpellings = new WeakMap()
    preparedByNames.set(artistNames, bySpellings)
  }
  let prepared = bySpellings.get(spellings)
  if (!prepared) {
    // Its own copy of the two, not the library they came with: kept for as
    // long as the names are, it must not hold a refetched-away library.
    const names: LibraryNames = { artistNames, spellings }
    prepared = preparedNamesFor<Song>(song => songSearchNames(song, names))
    bySpellings.set(spellings, prepared)
  }
  return prepared
}

/**
 * Songs best-first for a query: the library's search, and the palette's.
 * One matcher and one set of names for both, so they cannot disagree. A song
 * is found by its title, artist and album, by each spelt in Latin letters,
 * and by the names its artists also go by (`names`).
 */
export function searchSongs<S extends Song>(
  query: string,
  songs: readonly S[],
  names: LibraryNames = NO_NAMES,
): FuzzyMatch<S>[] {
  return fuzzyRankPrepared(query, songs, preparedNames(names))
}

export function filterSongs(
  songs: readonly Song[],
  filter: LibraryFilter,
  isDownloaded: (songId: number) => boolean,
): Song[] {
  // No copy of its own: each filter makes a new array, and so does the sort.
  let result: readonly Song[] = songs

  if (tagFiltered(filter)) {
    result = result.filter(song => tagMatchCount(song, filter.tagIds) > 0)
  }
  if (filter.downloadedOnly) result = result.filter(song => isDownloaded(song.id))

  // The shared comparison, so the phone and the desktop put the same library in
  // the same order.
  const sorted = sortSongs(result, filter.sort, filter.descending)
  return filter.tagIds.length > 1 ? byTagMatches(sorted, filter.tagIds) : sorted
}

/**
 * The songs carrying the most of the chosen tags first, and within each group
 * the order they already had.
 *
 * This is what makes "any of these tags" usable as the only rule. Two tags
 * give you everything either one covers — so a second tap can never empty the
 * screen — but the songs that are both play first, which is what you meant by
 * tapping two. One tag has nothing to rank, hence the caller's check.
 *
 * Bucketed rather than sorted by count: a sort would have to be stable to keep
 * the order inside each group, and grouping says so outright.
 */
function byTagMatches(songs: readonly Song[], tagIds: readonly number[]): Song[] {
  // buckets[n] holds the songs carrying n of the tags; 0 is never filled,
  // because a song matching none of them is not in the list at all.
  const buckets: Song[][] = Array.from({ length: tagIds.length + 1 }, () => [])
  for (const song of songs) buckets[tagMatchCount(song, tagIds)]?.push(song)
  const ordered: Song[] = []
  for (let matches = tagIds.length; matches > 0; matches -= 1) {
    ordered.push(...(buckets[matches] ?? []))
  }
  return ordered
}

/**
 * How many of `songs` carry every one of the chosen tags — the "62 have all
 * three, and come first" line under a tagged library.
 *
 * Worth saying out loud only because the union is the surprising half of the
 * rule: someone who taps "chill" and "中文" expecting an intersection needs to
 * see that the intersection is still there, at the top.
 */
export function bothTagsCount(songs: readonly Song[], tagIds: readonly number[]): number {
  if (tagIds.length < 2) return 0
  return songs.filter(song => tagMatchCount(song, tagIds) === tagIds.length).length
}

/** Tags that are actually used, so the filter row is not full of dead chips. */
export function usedTags(songs: readonly Song[], tags: readonly Tag[]): Tag[] {
  const used = new Set<number>()
  for (const song of songs) for (const id of song.tagIds) used.add(id)
  return tags.filter(tag => used.has(tag.id))
}
