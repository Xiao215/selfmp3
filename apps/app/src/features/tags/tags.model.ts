/**
 * The Tags page, without the screen.
 *
 * A computer picks tags from its sidebar. A phone picks them here, and the
 * page keeps the same filter the library reads, so what is chosen here is
 * playing there.
 */

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
