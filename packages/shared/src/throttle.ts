/**
 * At most one delivery per interval: the download queue's progress (any
 * client), and the desktop shell's download progress across IPC.
 *
 * A transfer reports progress for every chunk it reads — hundreds a second on
 * a fast connection — and every report reaching every listener means rendering
 * every screen that knows about downloads. A bar that moves four times a
 * second looks exactly as smooth to a person.
 *
 * Leading only, with no timer to deliver a late one: this package compiles
 * against ES2023 alone, where `setTimeout` does not exist, on purpose (see
 * `platform.ts`). Nothing is lost by it. A delivery reads whatever is latest
 * when it happens, so a report held back is carried by the next one — the next
 * chunk, or the change that ends a transfer (finished, paused, failed, called
 * off), which is never held back and calls `settle()` — or, where nothing
 * else carries it, `flush()`, which delivers the held-back one. The one thing a
 * timer would add is the last quarter-second of a transfer that stalls outright.
 *
 * No timer, either, because shared runs everywhere: a phone, a worker, Node.
 */

export interface Throttle {
  /** Something changed: deliver now, unless the last delivery was too recent. */
  request(): void
  /** The latest has just been delivered some other way; the interval starts again from here. */
  settle(): void
  /** Deliver now if a request was held back since the last delivery: the end of a transfer. */
  flush(): void
}

export function createThrottle(
  deliver: () => void,
  intervalMs: number,
  now: () => number = () => Date.now(),
): Throttle {
  let last = Number.NEGATIVE_INFINITY
  let owed = false
  return {
    request() {
      const at = now()
      if (at - last < intervalMs) {
        owed = true
        return
      }
      last = at
      owed = false
      deliver()
    },
    settle() {
      last = now()
      owed = false
    },
    flush() {
      if (!owed) return
      last = now()
      owed = false
      deliver()
    },
  }
}
