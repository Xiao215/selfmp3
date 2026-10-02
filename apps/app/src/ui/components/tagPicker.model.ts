import type { Song } from '@selfmp3/shared'

/**
 * What a tag is to a set of songs: on every one of them, on some, or on none.
 * The picker draws the first as ticked and the second as mixed, and a tap on
 * either kind of tag that is not on all of them puts it on all of them; a tap
 * on one that is takes it off all of them.
 */
interface TagsAcross {
  /** Tags every song carries. */
  readonly all: ReadonlySet<number>
  /** Tags some but not all carry. */
  readonly some: ReadonlySet<number>
}

export function tagsAcross(songs: readonly Song[]): TagsAcross {
  const counts = new Map<number, number>()
  for (const song of songs) {
    for (const tagId of song.tagIds) counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
  }
  const all = new Set<number>()
  const some = new Set<number>()
  for (const [tagId, count] of counts) (count === songs.length ? all : some).add(tagId)
  return { all, some }
}

/**
 * The tags to put on every song and to take off every song, to go from what
 * the picker shows (`before`) to what was ticked (`next`), and what it shows
 * after. A mixed tag that was ticked goes on the rest and stops being mixed;
 * one that was not is left as it is.
 *
 * `before` is the picker's own, not the library's: the bulk edit waits for a
 * refetch, and a tap that lands first must not be measured against songs
 * that have not heard about the tap before it.
 */
export function tagChanges(
  before: TagsAcross,
  next: ReadonlySet<number>,
): { readonly add: number[]; readonly remove: number[]; readonly after: TagsAcross } {
  const add = [...next].filter(id => !before.all.has(id))
  const remove = [...before.all].filter(id => !next.has(id))
  const some = new Set([...before.some].filter(id => !next.has(id)))
  return { add, remove, after: { all: next, some } }
}
