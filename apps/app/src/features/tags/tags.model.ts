/**
 * All tags, without the screen (docs/ui-mock `P07`).
 *
 * The rows themselves — their order, their line, the untagged card's title —
 * are the tag model's (`features/tag/tag.model.ts`), because Home's tiles and
 * a tag's own page count the same way. What is left here is the page's own
 * words.
 */

/** "8 tags · most played first", under the title, or what to say when there are none. */
export function tagsHeadline(count: number): string {
  if (count === 0) return 'No tags yet'
  return `${count.toLocaleString()} ${count === 1 ? 'tag' : 'tags'} · most played first`
}
