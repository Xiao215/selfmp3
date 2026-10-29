import { naturalOrder, type Song, type Tag } from '@selfmp3/shared'

/**
 * A tag in a picker's list, and whether it is one of the ticked library's yet
 * — or only this device's.
 */
export interface Offered {
  readonly tag: Tag
  readonly there: boolean
}

const byName = (a: Offered, b: Offered): number => naturalOrder(a.tag.name, b.tag.name)

/**
 * What a picker lists before anything is typed, in the order a person reads
 * names: "manytag-2" before "manytag-10", as a song's own chips are (R2-P16).
 * With `from` — another library's tags, when the ticks are not this device's —
 * those first, then this device's whose names it has not got, which ticking
 * makes there.
 */
export function offeredTags(own: readonly Tag[], from?: readonly Tag[]): Offered[] {
  if (!from) return own.map(tag => ({ tag, there: true })).sort(byName)
  const named = new Set(from.map(tag => tag.name.toLowerCase()))
  return [
    ...from.map(tag => ({ tag, there: true })).sort(byName),
    ...own
      .filter(tag => !named.has(tag.name.toLowerCase()))
      .map(tag => ({ tag, there: false }))
      .sort(byName),
  ]
}

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

/**
 * What the picker shows once one tag's change has failed, from what it shows
 * now (`current`) and what it showed before that tap (`before`): that tag goes
 * back to what it was, and every other tap stands — each bulk change is a tag
 * of its own, so a later tap's answer says nothing about this one. A tag that
 * has been tapped again since is the later tap's, and is left alone.
 */
export function undoTagChange(
  current: TagsAcross,
  before: TagsAcross,
  tagId: number,
  action: 'add' | 'remove',
): TagsAcross {
  if (action === 'add') {
    if (!current.all.has(tagId)) return current
    const all = new Set(current.all)
    all.delete(tagId)
    const some = before.some.has(tagId) ? new Set([...current.some, tagId]) : current.some
    return { all, some }
  }
  if (current.all.has(tagId) || current.some.has(tagId)) return current
  return { all: new Set([...current.all, tagId]), some: current.some }
}

/** A tick on one song not yet answered: whether it put the tag on, and which tick it was. */
export interface PendingTick {
  readonly on: boolean
  readonly tick: number
}

/**
 * What the picker on one song shows: the song's tags as the library has them
 * now, with the ticks still on their way laid over them. Read from the library
 * rather than kept from when the picker opened, so a tag another device put on
 * meanwhile shows ticked — and stays on, since each tick sends only itself.
 */
export function songPickerTicks(
  held: readonly number[],
  pending: ReadonlyMap<number, PendingTick>,
): ReadonlySet<number> {
  const ticked = new Set(held)
  for (const [tagId, { on }] of pending) {
    if (on) ticked.add(tagId)
    else ticked.delete(tagId)
  }
  return ticked
}

/** The ticks on their way with this one's tags added. */
export function withPendingTicks(
  pending: ReadonlyMap<number, PendingTick>,
  change: { readonly add: readonly number[]; readonly remove: readonly number[] },
  tick: number,
): ReadonlyMap<number, PendingTick> {
  const next = new Map(pending)
  for (const tagId of change.add) next.set(tagId, { on: true, tick })
  for (const tagId of change.remove) next.set(tagId, { on: false, tick })
  return next
}

/**
 * The ticks on their way once this one is answered, or refused: its tags go
 * back to what the song says, unless a later tick has taken them since.
 */
export function settledTicks(
  pending: ReadonlyMap<number, PendingTick>,
  tagIds: readonly number[],
  tick: number,
): ReadonlyMap<number, PendingTick> {
  const next = new Map(pending)
  for (const tagId of tagIds) if (next.get(tagId)?.tick === tick) next.delete(tagId)
  return next
}

/** The tags to put on and take off one song, to go from what is shown to what was ticked. */
export function songTagChange(
  shown: ReadonlySet<number>,
  next: ReadonlySet<number>,
): { readonly add: number[]; readonly remove: number[] } {
  return {
    add: [...next].filter(id => !shown.has(id)),
    remove: [...shown].filter(id => !next.has(id)),
  }
}
