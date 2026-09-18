/**
 * The Tags page, without the screen.
 *
 * A computer edits tags from the ⋯ on a sidebar row. A phone has nowhere to
 * put that, so this page is it: naming, colouring and deleting tags. It does
 * not pick what plays — that is the library's picker at both widths, which
 * shows the songs under the chips as it picks them.
 */

import { fuzzyRank } from '@selfmp3/shared'

/** The tag this name already is, whatever the case, so "＋ New tag" does not make a twin. */
export function existingTag<T extends { name: string }>(
  tags: readonly T[],
  name: string,
): T | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  return tags.find(tag => tag.name.trim().toLowerCase() === wanted) ?? null
}

/** "15 songs". */
export function songCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`
}

/**
 * The order tags are listed in to be managed: the ones carrying the most
 * songs first, ties by name.
 *
 * Most-used first because that is the order they matter in — the tag on two
 * hundred songs is the one worth renaming carefully — and because a library
 * accumulates one-song tags that would otherwise lead an alphabet. A search
 * replaces the order with its own ranking, as it does in the picker.
 */
export function tagsToManage<T extends { name: string; songCount: number }>(
  tags: readonly T[],
  query = '',
): readonly T[] {
  const trimmed = query.trim()
  if (trimmed) return fuzzyRank(trimmed, tags, tag => tag.name).map(match => match.item)
  return [...tags].sort((a, b) => b.songCount - a.songCount || a.name.localeCompare(b.name))
}

/** "9 tags", or what to say when there are none. */
export function tagsHeadline(count: number): string {
  if (count === 0) return 'No tags yet'
  return `${count.toLocaleString()} ${count === 1 ? 'tag' : 'tags'}`
}
