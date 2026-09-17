import type { Tag } from '@selfmp3/shared'

/**
 * The few tags the sidebar offers, and the list behind them.
 *
 * A rail cannot hold a library's tags. Two hundred of them turn the sidebar
 * into a scroll nobody reaches the bottom of, and the four that matter — the
 * ones reached for yesterday — are somewhere in the middle of it. So the rail
 * shows four and the rest live in the picker's search.
 *
 * Which four is decided by use rather than by a star, because a pinned list is
 * a thing to maintain: you set it up once, your listening moves on, and it is
 * quietly wrong for a year. Use order needs nothing from anybody and is right
 * by tomorrow.
 *
 * Pure, so the rule can be tested without a device; the string is kept by the
 * `prefs` port, which is the app's small per-device store.
 */

/** The `prefs` key. Ids only — names and colours come from the library. */
export const RECENT_TAGS_KEY = 'recent-tags'

/** How many ids are remembered. More than the rail shows, so removing one from the filter uncovers the one before it. */
const REMEMBERED = 12

/**
 * Ids out of a stored string, ignoring anything that is not one.
 *
 * Defensive because this is read at startup from a store a person can edit
 * (it is `localStorage` in a browser) and a sidebar that throws takes the whole
 * app with it.
 */
export function parseRecentTagIds(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
      .slice(0, REMEMBERED)
  } catch {
    return []
  }
}

export function serialiseRecentTagIds(ids: readonly number[]): string {
  return JSON.stringify(ids.slice(0, REMEMBERED))
}

/** This tag to the front, once, and the oldest dropped off the end. */
export function withTagUsed(ids: readonly number[], tagId: number): number[] {
  return [tagId, ...ids.filter(id => id !== tagId)].slice(0, REMEMBERED)
}

/**
 * The tags the rail shows: most recently used first, then the biggest tags to
 * fill the row.
 *
 * The fill is what makes the first run work. A device that has never filtered
 * by a tag has no history, and an empty "Recent tags" would be a section
 * heading over nothing — so it starts as the four largest tags, which is the
 * best guess available, and turns into real history as soon as anything is
 * used.
 *
 * A remembered id whose tag has since been deleted is skipped rather than
 * shown as a gap.
 */
export function railTags(
  recentIds: readonly number[],
  tags: readonly Tag[],
  count = 4,
): Tag[] {
  const byId = new Map(tags.map(tag => [tag.id, tag]))
  const chosen: Tag[] = []
  const taken = new Set<number>()
  for (const id of recentIds) {
    if (chosen.length === count) break
    const tag = byId.get(id)
    if (tag && !taken.has(tag.id)) {
      chosen.push(tag)
      taken.add(tag.id)
    }
  }
  if (chosen.length < count) {
    const biggest = [...tags]
      .filter(tag => !taken.has(tag.id))
      .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
    chosen.push(...biggest.slice(0, count - chosen.length))
  }
  return chosen
}

/** How many of each group is worth offering before search is the better tool. */
const MOST_USED = 12
const LATELY = 4

/**
 * The two rows the tag chooser offers before anything is typed.
 *
 * **Most used** is by song count, which is the only measure of a tag's weight
 * the library actually keeps. A tag already chosen keeps its place rather than
 * jumping to the front, so the chips you are picking do not move under you.
 *
 * **Lately** is the newest tags, by id — ids are handed out in order, so the
 * largest are the most recently made. It is the row that catches this week's
 * imports, which are exactly the tags a count-ordered list buries. A tag in the
 * first row is left out of it rather than shown twice.
 *
 * A chosen tag in neither row is put at the front of the first, or it would be
 * invisible while it was on and could not be tapped off without searching for
 * it.
 */
export function chooserTagGroups(
  tags: readonly Tag[],
  selected: readonly number[],
): { mostUsed: Tag[]; lately: Tag[] } {
  const mostUsed = [...tags]
    .sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
    .slice(0, MOST_USED)
  const shown = new Set(mostUsed.map(tag => tag.id))
  const lately = [...tags]
    .filter(tag => !shown.has(tag.id))
    .sort((a, b) => b.id - a.id)
    .slice(0, LATELY)
  const inLately = new Set(lately.map(tag => tag.id))
  const missing = tags.filter(
    tag => selected.includes(tag.id) && !shown.has(tag.id) && !inLately.has(tag.id),
  )
  return { mostUsed: [...missing, ...mostUsed], lately }
}
