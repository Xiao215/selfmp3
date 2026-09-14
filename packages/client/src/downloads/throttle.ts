/**
 * At most one delivery per interval.
 *
 * A transfer reports progress for every chunk it reads — hundreds a second on
 * a fast connection — and each report used to reach every listener, which in
 * the app meant rendering every screen that knows about downloads. A bar that
 * moves four times a second looks exactly as smooth to a person.
 *
 * Leading only, with no timer to deliver a late one: this package compiles
 * against ES2023 alone, where `setTimeout` does not exist, on purpose (see
 * `platform.ts`). Nothing is lost by it. A delivery reads whatever is latest
 * when it happens, so a report held back is carried by the next one — the next
 * chunk, or the change that ends a transfer (finished, paused, failed, called
 * off), which is never held back and calls `settle()`. The one thing a timer
 * would add is the last quarter-second of a transfer that stalls outright.
 */

export interface Throttle {
  /** Something changed: deliver now, unless the last delivery was too recent. */
  request(): void
  /** The latest has just been delivered some other way; the interval starts again from here. */
  settle(): void
}

export function createThrottle(
  deliver: () => void,
  intervalMs: number,
  now: () => number = () => Date.now(),
): Throttle {
  let last = Number.NEGATIVE_INFINITY
  return {
    request() {
      const at = now()
      if (at - last < intervalMs) return
      last = at
      deliver()
    },
    settle() {
      last = now()
    },
  }
}
