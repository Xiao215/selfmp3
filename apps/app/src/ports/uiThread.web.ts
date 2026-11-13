/** A browser has one thread: the worklet is just called (`uiThread.ts`). */
export function onUIThread<Args extends unknown[], Result>(
  work: (...args: Args) => Result,
  ...args: Args
): Result {
  return work(...args)
}
