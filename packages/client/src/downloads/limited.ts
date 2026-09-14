/**
 * Work over a list, a few at a time, stoppable.
 *
 * For background passes that touch every song — keeping covers and words on
 * this device. Started all at once, a library of thousands is thousands of
 * requests and file checks in the same instant; one at a time, the first pass
 * takes all afternoon. A handful at once is both polite and done.
 *
 * Best effort by design: an item that throws is that item's problem, and the
 * rest still run. `cancelled` is asked before each item starts, so a pass that
 * is called off stops within `limit` items rather than finishing the list.
 *
 * Resolves true when every item ran, false when the pass was called off.
 */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  cancelled: () => boolean = () => false,
): Promise<boolean> {
  let next = 0
  let stopped = false

  const worker = async (): Promise<void> => {
    for (;;) {
      if (cancelled()) {
        stopped = true
        return
      }
      const at = next
      next += 1
      if (at >= items.length) return
      try {
        await work(items[at] as T)
      } catch {
        // Left for the next pass; see above.
      }
    }
  }

  const workers = Math.max(1, Math.min(Math.floor(limit), items.length))
  await Promise.all(Array.from({ length: workers }, worker))
  return !stopped && !cancelled()
}
