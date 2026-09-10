/**
 * A minimal "at most one call every N milliseconds" gate.
 *
 * MusicBrainz asks for one request per second per client and blocks IPs that
 * exceed it, so every call to it goes through one of these. Callers `await
 * acquire()` and are released in the order they asked; the bookkeeping is a
 * single timestamp, so there is no queue to drain or leak.
 */
export class RateLimiter {
  readonly #intervalMs: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  #nextFreeAt = 0

  constructor(
    intervalMs: number,
    hooks: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.#intervalMs = intervalMs
    this.#now = hooks.now ?? (() => Date.now())
    this.#sleep = hooks.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  /** Resolves once the caller is allowed to make its request. */
  async acquire(): Promise<void> {
    const now = this.#now()
    // Reserve the slot synchronously, before awaiting, so concurrent callers
    // each get a distinct slot instead of all reading the same timestamp.
    const slot = Math.max(now, this.#nextFreeAt)
    this.#nextFreeAt = slot + this.#intervalMs
    const wait = slot - now
    if (wait > 0) await this.#sleep(wait)
  }
}
