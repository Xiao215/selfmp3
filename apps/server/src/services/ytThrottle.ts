/**
 * How fast this server is willing to ask YouTube for things.
 *
 * yt-dlp's own measurements put the ceiling at roughly 300 videos an hour for
 * a signed-out session and 2000 for an account. Those are observations of an
 * unpublished limit, not a contract, and the penalty for crossing it is not a
 * slowdown — it is an IP-level block that outlasts any backoff and gives no
 * sign of when it lifts. A single listener importing music is nowhere near
 * needing the full ceiling, so this runs at a quarter of it and never probes
 * for more: the throughput given up is throughput nobody was going to use.
 *
 * The shape is a token bucket rather than a delay between downloads, because
 * the constraint is a rate over an hour and a delay has no memory of it. Ten
 * songs go at once because the bucket is full; a hundred burst and then settle
 * to the sustained rate; ten songs ten times in an hour slow down by
 * themselves, which is the case a per-song or per-batch delay cannot see.
 *
 * Everything here is pure: state goes in, state comes out, and the caller
 * supplies the clock. That is what lets an hour of queue behaviour be tested
 * in a millisecond.
 */

/** Observed ceilings, per hour. See the yt-dlp wiki's Extractors page. */
const CEILING_SIGNED_OUT = 300
const CEILING_SIGNED_IN = 2000

/**
 * The fraction of the observed ceiling this server will actually use.
 *
 * A quarter, because the ceiling is measured rather than promised and the
 * failure past it is a cliff. At 75 requests an hour signed out, a two hundred
 * song backfill takes an afternoon in the background and everything smaller is
 * instant — which is the whole of what one person needs.
 */
const SAFETY = 0.25

/** How many requests may go at once out of a full bucket. */
const BURST_SIGNED_OUT = 30
const BURST_SIGNED_IN = 50

/** A rate-limit answer stops the queue for this long, whatever the bucket says. */
export const PAUSE_MS = 15 * 60 * 1000

/** Two blocks inside this window are the same incident, and ratchet down once. */
const RATCHET_COOLDOWN_MS = 30 * 60 * 1000

/** The budget is never cut below this fraction of its starting value. */
const MIN_RATCHET = 1 / 16

/**
 * What the bucket remembers between restarts.
 *
 * `ratchet` is a multiplier on the budget that only ever falls. It is separate
 * from the budget itself so that signing in — which raises the ceiling — takes
 * effect at once without forgetting that this network has been blocked before.
 */
export interface ThrottleState {
  /** Whole and partial requests available right now. */
  readonly tokens: number
  /** Multiplicative decrease, 1 down to MIN_RATCHET. Never climbs on its own. */
  readonly ratchet: number
  /** When `tokens` was last brought up to date (epoch ms). */
  readonly updatedAt: number
  /** Nothing may go before this (epoch ms). Set by a rate-limit answer. */
  readonly pausedUntil: number
  /** When YouTube last refused us for rate (epoch ms), for the ratchet cooldown. */
  readonly limitedAt: number
}

export function freshState(now: number): ThrottleState {
  return { tokens: 0, ratchet: 1, updatedAt: now, pausedUntil: 0, limitedAt: 0 }
}

/** Requests an hour this server will make, before the bucket's own accounting. */
export function budgetPerHour(state: ThrottleState, signedIn: boolean): number {
  const ceiling = signedIn ? CEILING_SIGNED_IN : CEILING_SIGNED_OUT
  return ceiling * SAFETY * state.ratchet
}

export function burstCapacity(signedIn: boolean): number {
  return signedIn ? BURST_SIGNED_IN : BURST_SIGNED_OUT
}

/**
 * Bring `tokens` up to date for the time that has passed.
 *
 * A bucket that refills by elapsed time needs nothing stored but the last time
 * it was touched, so a restart — or a laptop that was asleep — recovers the
 * right number without a timer having run.
 */
export function refill(state: ThrottleState, signedIn: boolean, now: number): ThrottleState {
  const elapsed = Math.max(0, now - state.updatedAt)
  if (elapsed === 0) return state
  const perMs = budgetPerHour(state, signedIn) / 3_600_000
  const capacity = burstCapacity(signedIn)
  return {
    ...state,
    tokens: Math.min(capacity, state.tokens + elapsed * perMs),
    updatedAt: now,
  }
}

/**
 * How long until one request may go: 0 when it may go now.
 *
 * A pause outranks the bucket, so a block that arrived with tokens to spare
 * still stops everything.
 */
export function waitMs(state: ThrottleState, signedIn: boolean, now: number): number {
  const paused = Math.max(0, state.pausedUntil - now)
  const filled = refill(state, signedIn, now)
  if (filled.tokens >= 1) return paused
  const perMs = budgetPerHour(filled, signedIn) / 3_600_000
  const untilToken = perMs > 0 ? Math.ceil((1 - filled.tokens) / perMs) : Number.MAX_SAFE_INTEGER
  return Math.max(paused, untilToken)
}

/**
 * Take one request's worth, if there is one. `null` when there is not, so the
 * caller decides whether to wait or to say so.
 */
export function spend(state: ThrottleState, signedIn: boolean, now: number): ThrottleState | null {
  if (now < state.pausedUntil) return null
  const filled = refill(state, signedIn, now)
  if (filled.tokens < 1) return null
  return { ...filled, tokens: filled.tokens - 1 }
}

/**
 * YouTube refused us for rate. Empty the bucket, stop for a while, and cut the
 * budget in half.
 *
 * The cut is permanent on purpose. Climbing back would mean probing for the
 * limit again, and every probe that finds it costs hours of service on a block
 * whose end cannot be observed — so the decision to try a larger budget again
 * belongs to a person who knows whether anything changed, not to a loop.
 */
export function penalize(state: ThrottleState, now: number): ThrottleState {
  const sameIncident = state.limitedAt > 0 && now - state.limitedAt < RATCHET_COOLDOWN_MS
  const ratchet = sameIncident ? state.ratchet : Math.max(MIN_RATCHET, state.ratchet / 2)
  return {
    tokens: 0,
    ratchet,
    updatedAt: now,
    pausedUntil: now + PAUSE_MS,
    limitedAt: now,
  }
}

/** Undo every past cut. A person's call — see `penalize`. */
export function resetRatchet(state: ThrottleState, now: number): ThrottleState {
  return { ...state, ratchet: 1, pausedUntil: 0, limitedAt: 0, updatedAt: now }
}

/**
 * Whether a yt-dlp failure is YouTube refusing us for rate rather than
 * anything being wrong with the song.
 *
 * The wording is deliberately the thing matched rather than an exit code:
 * yt-dlp exits 1 for a private video and for a bot wall alike, and only the
 * message tells them apart. "Sign in to confirm you're not a bot" is the
 * famous one, but a 429, Google's /sorry interstitial and the living-room
 * client's "page needs to be reloaded" are the same refusal wearing other
 * words. Age-gating also says "sign in to confirm", about the viewer's age,
 * and is not this — so the bot wording is matched, not "sign in" alone.
 */
export function isRateLimited(message: string): boolean {
  const lower = message.toLowerCase()
  return [
    'not a bot',
    'http error 429',
    'too many requests',
    'the page needs to be reloaded',
    '/sorry/',
    'unusual traffic',
  ].some(phrase => lower.includes(phrase))
}

/**
 * YouTube refused the address for rate.
 *
 * A class rather than a phrase to look for, because the message is rewritten
 * for people on its way up (ytCookies.ts) and the first version of this looked
 * for yt-dlp's wording in text that no longer contained it: the explanation
 * and the detection each worked, and together they cancelled out. The type
 * survives whatever the message is changed to say.
 */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RateLimitedError'
  }
}

/** What the throttle looks like from outside, for the UI and the doctor. */
interface ThrottleStatus {
  /** ms until the next request may go. 0 when nothing is holding it back. */
  readonly waitMs: number
  /** Set while a rate-limit answer is still being waited out (epoch ms). */
  readonly pausedUntil: number | null
  /** Requests an hour this server is currently willing to make. */
  readonly budgetPerHour: number
  /** 1 until YouTube has refused us; halved by each separate incident. */
  readonly ratchet: number
}

/** Where the bucket's state is kept between restarts. */
interface ThrottleStore {
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

  /** ms until a request may go; 0 when one may go now. */
  waitMs(): number {
    const now = this.#now()
    return waitMs(this.#store.get(now), this.#signedIn(), now)
  }

  status(): ThrottleStatus {
    const now = this.#now()
    const state = this.#store.get(now)
    const signedIn = this.#signedIn()
    return {
      waitMs: waitMs(state, signedIn, now),
      pausedUntil: state.pausedUntil > now ? state.pausedUntil : null,
      budgetPerHour: budgetPerHour(state, signedIn),
      ratchet: state.ratchet,
    }
  }

  /** Take one request's worth if one is there. Does not wait. */
  tryTake(): boolean {
    const now = this.#now()
    const next = spend(this.#store.get(now), this.#signedIn(), now)
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
   */
  async take(
    options: { signal?: AbortSignal; maxWaitMs?: number; waitOutPause?: boolean } = {},
  ): Promise<boolean> {
    const { signal, maxWaitMs, waitOutPause = true } = options
    const deadline = maxWaitMs === undefined ? null : this.#now() + maxWaitMs

    for (;;) {
      signal?.throwIfAborted()
      if (this.tryTake()) return true
      if (!waitOutPause && this.status().pausedUntil !== null) return false

      const wait = this.waitMs()
      if (deadline !== null && this.#now() + wait > deadline) return false
      // Never sleep the whole wait in one go: the pause can be lifted by hand,
      // and a caller asleep for fifteen minutes would not notice.
      await sleep(Math.max(50, Math.min(wait, RECHECK_MS)), signal)
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
