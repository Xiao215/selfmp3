import { runOnUISync } from 'react-native-worklets'

/**
 * A worklet run on the UI thread now, the JS thread waiting the moment that
 * takes, and what it gave back: for what the UI thread owns (the sound map's
 * view), so a press reads and moves it where the gestures do and nothing
 * queued in between can come out of order. A browser has one thread, so its
 * port just calls it.
 */
export function onUIThread<Args extends unknown[], Result>(
  work: (...args: Args) => Result,
  ...args: Args
): Result {
  return runOnUISync(work, ...args)
}
