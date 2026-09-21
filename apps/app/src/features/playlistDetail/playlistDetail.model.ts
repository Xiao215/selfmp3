/**
 * The rules of reordering a manual playlist, with nothing drawn.
 *
 * The server is sent the whole new order rather than a move instruction, so
 * what matters here is producing that order correctly and deciding where a
 * dragged row lands — both easy to get subtly wrong at the ends of the list,
 * and both checkable without a finger or a mouse.
 */

/**
 * Whether the page just behind this one in the stack is `route` — the
 * navigator's name for it, such as `playlists/index` or `index`.
 *
 * A back link names where it goes ("‹ Playlists", "Back to the library"), and
 * `router.back()` goes wherever the stack says instead: to the library after a
 * playlist made from a selection there, or out of the app after a deep link.
 * Where this is false the link replaces the page with the one it names, so it
 * says what it does and no page is stacked twice.
 */
export function cameFrom(
  state:
    { readonly index: number; readonly routes: readonly { readonly name: string }[] } | undefined,
  route: string,
): boolean {
  if (!state || state.index < 1) return false
  return state.routes[state.index - 1]?.name === route
}

/** The list with the item at `from` taken out and put back in at `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}

/**
 * Which row a drag has reached: the row it started on, moved by however many
 * whole rows the pointer has travelled, and never past either end.
 */
export function dropIndex(from: number, dy: number, rowHeight: number, count: number): number {
  if (count <= 0) return 0
  const rows = rowHeight > 0 ? Math.round(dy / rowHeight) : 0
  return Math.max(0, Math.min(count - 1, from + rows))
}

/** Which edge of a row the drop line falls on, or none for a row it is not over. */
export type DropSide = 'above' | 'below'

/**
 * A row dragged downwards lands *after* the row it is over, because it was
 * lifted out of the list before being put back: `moveTo(0, 3)` on four songs
 * makes the first song the last. A line above that row promised a place one
 * higher than the song would take — dragged to the foot of a playlist it drew
 * the line above the last song and then put the song below it (Xiao,
 * 2026-09-21). Downwards the line belongs under the row; upwards, over it.
 */
export function dropSide(
  drag: { readonly from: number; readonly over: number } | null,
  index: number,
): DropSide | null {
  if (drag === null || drag.over !== index || drag.from === index) return null
  return drag.over > drag.from ? 'below' : 'above'
}

/**
 * What a finished move means: where the row landed, and the whole new order to
 * send. Null when it landed where it started — a hold let go without moving,
 * or a move that came back — and there is nothing to tell the server.
 *
 * One function for both ways of moving a row: the grip a mouse drags at
 * desktop width, and a held finger on a phone. They differ in how the travel
 * is measured, and in nothing after that.
 */
export function movedTo(
  songIds: readonly number[],
  from: number,
  dy: number,
  rowHeight: number,
): { to: number; songIds: number[] } | null {
  const to = dropIndex(from, dy, rowHeight, songIds.length)
  if (to === from) return null
  return { to, songIds: moveItem(songIds, from, to) }
}
