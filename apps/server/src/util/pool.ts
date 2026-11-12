/**
 * `work` over every item, `width` at a time, each worker taking the next item
 * as it finishes one; the answers in the items' order.
 *
 * The first item that throws is the answer: nothing new starts after it, since
 * whatever it would read or ask is thrown away with the rest.
 */
export async function pool<T, R>(
  items: readonly T[],
  width: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const at = next++
      try {
        results[at] = await work(items[at] as T)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
  return results
}
