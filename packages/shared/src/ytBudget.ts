import { z } from 'zod'

/**
 * How fast a server — or a device downloading for itself
 * (docs/features/client-download.md) — is willing to ask YouTube for things.
 * The server's bucket is apps/server/src/services/ytThrottle.ts; a device's
 * is the app's own, on the same rules, since it is the same YouTube counting
 * the same kind of address.
 *
 * yt-dlp's own measurements put the ceiling at roughly 300 videos an hour for
 * a signed-out session and 2000 for an account. Those are observations of an
 * unpublished limit, not a contract, and the penalty for crossing it is not a
 * slowdown — it is an IP-level block that outlasts any backoff and gives no
 * sign of when it lifts. A single listener importing music is nowhere near
 * needing the full ceiling, so this runs at half of it and never probes for
 * more: the throughput given up is throughput nobody was going to use.
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
 * Half, because the ceiling is measured rather than promised and the failure
 * past it is a cliff. It was a quarter — 75 an hour signed out, a song every
 * 48 seconds — and a forty-song album from the extension was a whole
 * afternoon of "nothing is downloading". At 150 an hour, one every 24
 * seconds, the album is a quarter of an hour, and a refusal still halves the
 * budget for good (`penalize`), so a network that turns out to be nearer the
 * cliff than the wiki says settles below it by itself.
 */
const SAFETY = 0.5

/** How many requests may go at once out of a full bucket. */
const BURST_SIGNED_OUT = 30
const BURST_SIGNED_IN = 50

/** A rate-limit answer stops the queue for this long, whatever the bucket says. */
export const PAUSE_MS = 15 * 60 * 1000

/**
 * How far below empty a person's request may take the bucket.
 *
 * The queue and the person spend from one bucket, and a long queue drained it
 * to the last token: pasting a link while forty songs were downloading was
 * told to try again in a minute, by the very downloads it had asked for. A
 * look-up, a preview or a listen may now borrow — take a token the bucket
 * does not have — and the queue, which has nowhere to be, waits that much
 * longer for its next. Keeping tokens back for a person instead stalled the
 * queue for minutes after every burst, waiting to be that far above empty.
 * Five is a handful of look-ups in a row before anyone waits.
 */
export const PERSON_MAY_BORROW = 5

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

/** The same, as stored somewhere that has to be read back and checked: a tab's localStorage. */
export const ThrottleStateSchema = z.object({
  tokens: z.number(),
  ratchet: z.number().positive().max(1),
  updatedAt: z.number(),
  pausedUntil: z.number(),
  limitedAt: z.number(),
})

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
 * How long until one request may go: 0 when it may go now. `borrow` is how
 * far below empty the caller may take the bucket (`PERSON_MAY_BORROW`).
 *
 * A pause outranks the bucket, so a block that arrived with tokens to spare
 * still stops everything.
 */
export function waitMs(state: ThrottleState, signedIn: boolean, now: number, borrow = 0): number {
  const paused = Math.max(0, state.pausedUntil - now)
  const filled = refill(state, signedIn, now)
  const needed = 1 - borrow
  if (filled.tokens >= needed) return paused
  const perMs = budgetPerHour(filled, signedIn) / 3_600_000
  const untilToken =
    perMs > 0 ? Math.ceil((needed - filled.tokens) / perMs) : Number.MAX_SAFE_INTEGER
  return Math.max(paused, untilToken)
}

/**
 * Take one request's worth, if there is one — or if the caller may borrow it,
 * leaving the bucket below empty to refill. `null` when there is not, so the
 * caller decides whether to wait or to say so.
 */
export function spend(
  state: ThrottleState,
  signedIn: boolean,
  now: number,
  borrow = 0,
): ThrottleState | null {
  if (now < state.pausedUntil) return null
  const filled = refill(state, signedIn, now)
  if (filled.tokens < 1 - borrow) return null
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
