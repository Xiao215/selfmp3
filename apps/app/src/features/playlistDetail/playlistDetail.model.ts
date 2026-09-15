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
  state: { readonly index: number; readonly routes: readonly { readonly name: string }[] } | undefined,
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
