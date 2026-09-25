import { describe, expect, it } from 'vitest'
import {
  budgetPerHour,
  burstCapacity,
  freshState,
  isRateLimited,
  penalize,
  refill,
  resetRatchet,
  spend,
  waitMs,
  PERSON_MAY_BORROW,
  PAUSE_MS,
  type ThrottleState,
} from './ytThrottle.js'

const T0 = 1_700_000_000_000
const HOUR = 3_600_000

/** A bucket filled to the brim, as one that has sat idle would be. */
function full(signedIn: boolean, now = T0): ThrottleState {
  return refill({ ...freshState(now - HOUR), tokens: 0 }, signedIn, now)
}

/** Spend `count` requests back to back, returning the state and what was refused. */
function drain(state: ThrottleState, signedIn: boolean, now: number, count: number) {
  let current = state
  let taken = 0
  for (let i = 0; i < count; i++) {
    const next = spend(current, signedIn, now)
    if (!next) break
    current = next
    taken++
  }
  return { state: current, taken }
}

describe('budget', () => {
  it('runs at half the observed ceiling, and higher when signed in', () => {
    const state = freshState(T0)
    expect(budgetPerHour(state, false)).toBe(150)
    expect(budgetPerHour(state, true)).toBe(1000)
  })
})

describe('the three cases a fixed delay cannot cover', () => {
  it('lets a small batch go at once, with no waiting at all', () => {
    const { taken } = drain(full(false), false, T0, 10)
    expect(taken).toBe(10)
    expect(waitMs(full(false), false, T0)).toBe(0)
  })

  it('bursts a large batch and then paces the rest', () => {
    const { state, taken } = drain(full(false), false, T0, 100)
    // The burst is the bucket's capacity; the rest has to wait for refill.
    expect(taken).toBe(burstCapacity(false))
    expect(spend(state, false, T0)).toBeNull()
    // 150 an hour is one every 24 seconds.
    expect(waitMs(state, false, T0)).toBeCloseTo(24_000, -3)
  })

  it('remembers small batches repeated through the hour', () => {
    // Twenty songs, ten times, six minutes apart: a per-batch delay sees ten
    // harmless batches. The bucket sees the two hundred requests they add up to.
    let state = full(false)
    let taken = 0
    for (let i = 0; i < 10; i++) {
      const round = drain(state, false, T0 + i * 6 * 60_000, 20)
      state = round.state
      taken += round.taken
    }
    expect(taken).toBeLessThan(200)
    // Never more than the hour's budget plus the burst it started full with.
    expect(taken).toBeLessThanOrEqual(150 + burstCapacity(false))
  })
})

describe('what a person may borrow', () => {
  it('lets a look-up go on an empty bucket, and makes the queue wait for it', () => {
    const { state } = drain(full(false), false, T0, burstCapacity(false))
    // The queue's next download has to wait for a real token.
    expect(spend(state, false, T0)).toBeNull()
    expect(waitMs(state, false, T0)).toBeCloseTo(24_000, -3)
    // A person's request goes now, below empty, and the queue waits a token longer.
    const borrowed = spend(state, false, T0, PERSON_MAY_BORROW)
    expect(borrowed?.tokens).toBeCloseTo(-1, 5)
    expect(waitMs(borrowed ?? state, false, T0)).toBeCloseTo(2 * 24_000, -3)
  })

  it('stops lending a few requests below empty', () => {
    let state = drain(full(false), false, T0, burstCapacity(false)).state
    for (let i = 0; i < PERSON_MAY_BORROW; i++) {
      const next = spend(state, false, T0, PERSON_MAY_BORROW)
      expect(next, `borrow ${i + 1}`).not.toBeNull()
      state = next ?? state
    }
    expect(spend(state, false, T0, PERSON_MAY_BORROW)).toBeNull()
    expect(waitMs(state, false, T0, PERSON_MAY_BORROW)).toBeCloseTo(24_000, -3)
    // The debt is paid down by the refill like any other token.
    expect(spend(state, false, T0 + 25_000, PERSON_MAY_BORROW)).not.toBeNull()
  })
})

describe('refill', () => {
  it('never fills past the burst capacity, however long it idles', () => {
    const state = refill(freshState(T0 - 100 * HOUR), false, T0)
    expect(state.tokens).toBe(burstCapacity(false))
  })

  it('recovers the right amount across a restart, with no timer having run', () => {
    // Nothing ran for six minutes; a tenth of the hour's budget should be back.
    const stored: ThrottleState = { ...freshState(T0), tokens: 0 }
    const woken = refill(stored, false, T0 + HOUR / 10)
    expect(woken.tokens).toBeCloseTo(15, 5)
  })

  it('caps a long sleep at the burst rather than banking the whole idle time', () => {
    // Half an hour earns 75, which is more than the bucket holds. Waking to
    // a full bucket is the point; waking to a backlog to spend at once is not.
    const stored: ThrottleState = { ...freshState(T0), tokens: 0 }
    expect(refill(stored, false, T0 + HOUR / 2).tokens).toBe(burstCapacity(false))
  })
})

describe('penalize', () => {
  it('stops everything for the pause, even with tokens in hand', () => {
    const punished = penalize(full(false), T0)
    expect(spend(punished, false, T0)).toBeNull()
    expect(waitMs(punished, false, T0)).toBe(PAUSE_MS)
    expect(spend(punished, false, T0 + PAUSE_MS + 1)).not.toBeNull()
  })

  it('halves the budget and does not climb back on its own', () => {
    const once = penalize(freshState(T0), T0)
    expect(budgetPerHour(once, false)).toBe(75)
    // An hour of nothing but success: still halved.
    const later = refill(once, false, T0 + 10 * HOUR)
    expect(budgetPerHour(later, false)).toBe(75)
  })

  it('treats a burst of blocks as one incident', () => {
    const first = penalize(freshState(T0), T0)
    const second = penalize(first, T0 + 60_000)
    expect(budgetPerHour(second, false)).toBe(budgetPerHour(first, false))
  })

  it('cuts again for a genuinely separate incident', () => {
    const first = penalize(freshState(T0), T0)
    const second = penalize(first, T0 + 2 * HOUR)
    expect(budgetPerHour(second, false)).toBe(37.5)
  })

  it('never cuts the budget to nothing', () => {
    let state = freshState(T0)
    for (let i = 0; i < 20; i++) state = penalize(state, T0 + i * 2 * HOUR)
    expect(budgetPerHour(state, false)).toBeGreaterThan(0)
    expect(budgetPerHour(state, false)).toBeCloseTo(300 * 0.5 * (1 / 16), 5)
  })

  it('is undone only by asking', () => {
    const punished = penalize(freshState(T0), T0)
    expect(budgetPerHour(resetRatchet(punished, T0), false)).toBe(150)
  })
})

describe('signing in', () => {
  it('raises the budget at once without forgetting a past block', () => {
    const punished = penalize(freshState(T0), T0)
    expect(budgetPerHour(punished, true)).toBe(500)
    expect(punished.ratchet).toBe(0.5)
  })
})

describe('isRateLimited', () => {
  it('knows the many ways YouTube says "slow down"', () => {
    for (const message of [
      "Sign in to confirm you're not a bot. Use --cookies-from-browser",
      'Unable to download webpage: HTTP Error 429: Too Many Requests',
      'The page needs to be reloaded.',
      'redirected to https://www.google.com/sorry/index?continue=...',
      'Our systems have detected unusual traffic from your computer network',
    ]) {
      expect(isRateLimited(message), message).toBe(true)
    }
  })

  it('does not mistake a broken song for a busy network', () => {
    for (const message of [
      'Private video. Sign in if you have been granted access to this video',
      'Video unavailable',
      'Sign in to confirm your age',
      'This video is available to Music Premium members only',
      'HTTP Error 403: Forbidden',
    ]) {
      expect(isRateLimited(message), message).toBe(false)
    }
  })
})
