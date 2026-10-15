import { setTimeout as sleep } from 'node:timers/promises'
import {
  budgetPerHour,
  waitMs,
  spend,
  penalize,
  resetRatchet,
  type ThrottleState,
} from '@selfmp3/shared'

/**
 * YouTube refused the address for rate.
 *
 * A class rather than a phrase to look for, because the message is rewritten
 * for people on its way up (ytCookies.ts) and no longer carries yt-dlp's
 * wording. The type survives whatever the message is changed to say.
 */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitedError'
  }
}

/** What the throttle looks like from outside, for the UI and the doctor. */
interface ThrottleStatus {
  /** ms until the queue's next download may go. 0 when nothing is holding it back. */
  readonly waitMs: number
  /** Set while a rate-limit answer is still being waited out (epoch ms). */
  readonly pausedUntil: number | null
  /** Requests an hour this server is currently willing to make. */
  readonly budgetPerHour: number
  /** 1 until YouTube has refused us; halved by each separate incident. */
  readonly ratchet: number
}

/** Where the bucket's state is kept between restarts. */
export interface ThrottleStore {
  get(now: number): ThrottleState
  save(state: ThrottleState): void
}

/** How often a waiting caller looks again, so it cannot oversleep a reset. */
const RECHECK_MS = 2_000

/**
 * The bucket, wired to storage and a clock.
 *
 * Every call that reaches YouTube goes through `take`, so probes, previews and
 * downloads all spend from the same budget — they are the same requests from
 * the same address, whatever asked for them.
 */
export class YtThrottleService {
  readonly #store: ThrottleStore
  readonly #signedIn: () => boolean
  readonly #now: () => number

  constructor(store: ThrottleStore, signedIn: () => boolean, now: () => number = Date.now) {
    this.#store = store
    this.#signedIn = signedIn
    this.#now = now
  }

  /** ms until a request may go, borrowing up to `borrow`; 0 when one may go now. */
  waitMs(borrow = 0): number {
    const now = this.#now()
    return waitMs(this.#store.get(now), this.#signedIn(), now, borrow)
  }

  status(): ThrottleStatus {
    const now = this.#now()
    const state = this.#store.get(now)
    const signedIn = this.#signedIn()
    return {
      // The queue's wait: what the import screen explains, and the doctor reads.
      waitMs: waitMs(state, signedIn, now),
      pausedUntil: state.pausedUntil > now ? state.pausedUntil : null,
      budgetPerHour: budgetPerHour(state, signedIn),
      ratchet: state.ratchet,
    }
  }

  /** Take one request's worth if one is there, or may be borrowed. Does not wait. */
  tryTake(borrow = 0): boolean {
    const now = this.#now()
    const next = spend(this.#store.get(now), this.#signedIn(), now, borrow)
    if (!next) return false
    this.#store.save(next)
    return true
  }

  /**
   * Wait for a request's worth, then take it.
   *
   * `maxWaitMs` is for the paths a person is sitting in front of — pasting a
   * link, previewing a track — where waiting out a fifteen minute pause is
   * worse than being told what is happening. The download queue passes none:
   * it has nowhere to be.
   *
   * `waitOutPause: false` separates the two reasons this waits. An empty
   * bucket is a wait of seconds that ends by itself, and a job is right to sit
   * through it. A pause is a quarter of an hour that the download queue
   * already knows how to spend: it declines to claim anything while one is on.
   * A job that was claimed in the moment before the refusal landed would
   * otherwise sit here holding a worker slot and reading as `running` for the
   * whole pause — the one thing the queue's scheduler is written not to do.
   * Such a job says so instead, and goes back in the queue it came from.
   *
   * `borrow` is a person's: their request may go on a token the bucket does
   * not have yet (`PERSON_MAY_BORROW`).
   */
  async take(
    options: {
      signal?: AbortSignal
      maxWaitMs?: number
      waitOutPause?: boolean
      borrow?: number
    } = {},
  ): Promise<boolean> {
    const { signal, maxWaitMs, waitOutPause = true, borrow = 0 } = options
    const deadline = maxWaitMs === undefined ? null : this.#now() + maxWaitMs

    for (;;) {
      signal?.throwIfAborted()
      if (this.tryTake(borrow)) return true
      if (!waitOutPause && this.status().pausedUntil !== null) return false

      const wait = this.waitMs(borrow)
      if (deadline !== null && this.#now() + wait > deadline) return false
      // Never sleep the whole wait in one go: the pause can be lifted by hand,
      // and a caller asleep for fifteen minutes would not notice.
      await sleep(Math.max(50, Math.min(wait, RECHECK_MS)), undefined, { signal })
    }
  }

  /** YouTube refused us for rate: empty the bucket, pause, cut the budget. */
  penalize(): void {
    const now = this.#now()
    this.#store.save(penalize(this.#store.get(now), now))
  }

  /** Undo every past cut and lift the pause. A person's call — see `penalize`. */
  reset(): void {
    const now = this.#now()
    this.#store.save(resetRatchet(this.#store.get(now), now))
  }
}
