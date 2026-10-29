/**
 * A short list that keeps its places while it is being pressed.
 *
 * The library's tag strip and the sidebar's tags lead with the ones used
 * last, and using one is pressing it: the chip jumped to the front in the
 * same frame and another slid under the pointer, so a second press on the
 * same spot turned a different tag on (or opened another tag's page).
 *
 * So an item already shown keeps its place, and the order the list would
 * now have decides only what is new: the items that join take the front, in
 * that order, and the ones that leave close up behind them. The list comes
 * back in its own order the next time it is drawn afresh.
 */
export function steadyOrder<T, K>(
  shown: readonly T[],
  next: readonly T[],
  key: (item: T) => K,
): T[] {
  const nextByKey = new Map(next.map(item => [key(item), item]))
  const shownKeys = new Set(shown.map(key))
  // The newest copy of each item kept, so a renamed or recoloured one is drawn as it is now.
  const kept = shown.flatMap(item => {
    const now = nextByKey.get(key(item))
    return now === undefined ? [] : [now]
  })
  const joining = next.filter(item => !shownKeys.has(key(item)))
  return [...joining, ...kept]
}
