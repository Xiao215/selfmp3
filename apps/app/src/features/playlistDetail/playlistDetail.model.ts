/**
 * The rules of reordering a manual playlist, with nothing drawn.
 *
 * The server is sent the whole new order rather than a move instruction, so
 * what matters here is producing that order correctly and deciding where a
 * dragged row lands — both easy to get subtly wrong at the ends of the list,
 * and both checkable without a finger or a mouse.
 */

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
