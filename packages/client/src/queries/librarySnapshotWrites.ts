import type { Library } from '@selfmp3/shared'
import type { RunLater } from '../platform.js'

/**
 * How often an answer that changed nothing but play counts is saved as the
 * offline library: at most once per this long.
 *
 * The library is asked for often — on coming back to the app, every half
 * minute a screen is looked at, after every edit — and saving it writes the
 * whole library each time: a multi-megabyte JSON file on the phone's JS
 * thread, or a structured clone into IndexedDB. An edit moves the library's
 * `version`, and an answer with a new version is saved straight away. A play
 * does not move it, so an answer with the same version can still carry newer
 * play counts and last-played times; those wait for this interval rather than
 * being dropped, so the offline copy's counts lag by no more than this.
 */
export const LIBRARY_SNAPSHOT_EVERY_MS = 5 * 60_000

export interface LibrarySnapshotWrites {
  /** An answer from the server: saved now, or kept until the interval allows. */
  readonly offer: (library: Library) => void
  /**
   * Drop the answer waiting for its turn, and save the next one straight away.
   * For when the library held is forgotten — another server, a sign-in or a
   * sign-out — and the waiting answer is no longer this device's library.
   */
  readonly forget: () => void
}

interface WritesOptions {
  readonly everyMs?: number
  readonly now?: () => number
  /**
   * How to save the waiting answer once the interval is up. This package
   * compiles with no timers (platform.ts), so the app brings one; without it
   * the waiting answer is saved by the first answer after the interval, which
   * is then the newer one anyway.
   */
  readonly later?: RunLater | null
}

/**
 * Saving the offline library, throttled: an answer whose version differs from
 * the last one saved is written at once, and one with the same version at
 * most once per `everyMs`. Between writes only the latest answer is kept, and
 * `later` saves it when the interval is up, so the last answer of a burst is
 * not lost to the throttle.
 */
export function createLibrarySnapshotWrites(
  write: (library: Library) => void,
  options: WritesOptions = {},
): LibrarySnapshotWrites {
  const everyMs = options.everyMs ?? LIBRARY_SNAPSHOT_EVERY_MS
  const now = options.now ?? (() => Date.now())
  /** The version last saved, or null when nothing has been saved since the start or a `forget`. */
  let savedVersion: number | null = null
  let savedAt = Number.NEGATIVE_INFINITY
  let waiting: Library | null = null
  let cancelLater: (() => void) | null = null

  function stopWaiting(): void {
    cancelLater?.()
    cancelLater = null
    waiting = null
  }

  function save(library: Library): void {
    stopWaiting()
    savedVersion = library.version
    savedAt = now()
    write(library)
  }

  return {
    offer: library => {
      if (library.version !== savedVersion || now() - savedAt >= everyMs) {
        save(library)
        return
      }
      waiting = library
      cancelLater ??=
        options.later?.(Math.max(0, savedAt + everyMs - now()), () => {
          cancelLater = null
          if (waiting) save(waiting)
        }) ?? null
    },
    forget: () => {
      stopWaiting()
      savedVersion = null
      savedAt = Number.NEGATIVE_INFINITY
    },
  }
}
