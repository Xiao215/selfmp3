import type { LibraryFilter } from '@selfmp3/client'

/**
 * The Tags page, without the screen.
 *
 * A computer filters by tag from its sidebar. A phone had no way to at all:
 * this page lists the tags, and tapping one shows its songs in the Library,
 * where the "Filtered by" row says so and clears it.
 */

/**
 * The library showing one tag's songs. Every other tag filter goes, and so
 * does a search, which would otherwise hide some of the songs just asked
 * for; the sort and "on this device" are the library's own settings and stay.
 */
export function onlyTag(filter: LibraryFilter, tagId: number): LibraryFilter {
  return { ...filter, query: '', includedTagIds: [tagId], excludedTagIds: [] }
}

/** The tag this name already is, whatever the case, so "＋ New tag" does not make a twin. */
export function existingTag<T extends { name: string }>(tags: readonly T[], name: string): T | null {
  const wanted = name.trim().toLowerCase()
  if (!wanted) return null
  return tags.find(tag => tag.name.trim().toLowerCase() === wanted) ?? null
}

/** "15 songs". */
export function songCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? 'song' : 'songs'}`
}
