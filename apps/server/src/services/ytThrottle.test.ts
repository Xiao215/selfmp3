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
  KEPT_FOR_PEOPLE,
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
  it('runs at a quarter of the observed ceiling, and higher when signed in', () => {
    const state = freshState(T0)
    expect(budgetPerHour(state, false)).toBe(75)
    expect(budgetPerHour(state, true)).toBe(500)
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
    // 75 an hour is one every 48 seconds.
    expect(waitMs(state, false, T0)).toBeCloseTo(48_000, -3)
  })

  it('remembers small batches repeated through the hour', () => {
    // Ten songs, ten times, six minutes apart: a per-batch delay sees ten
    // harmless batches. The bucket sees the hundred requests they add up to.
    let state = full(false)
    let taken = 0
    for (let i = 0; i < 10; i++) {
      const round = drain(state, false, T0 + i * 6 * 60_000, 10)
      state = round.state
      taken += round.taken
    }
    expect(taken).toBeLessThan(100)
    // Never more than the hour's budget plus the burst it started full with.
    expect(taken).toBeLessThanOrEqual(75 + burstCapacity(false))
  })
})

describe('what the queue leaves for a person', () => {
  it('stops the queue short of the last few, which a look-up may still take', () => {
    // Nearly drained: fewer left than the queue keeps back.
    const { state } = drain(full(false), false, T0, burstCapacity(false) - KEPT_FOR_PEOPLE + 2)
    expect(spend(state, false, T0, KEPT_FOR_PEOPLE)).toBeNull()
    expect(waitMs(state, false, T0, KEPT_FOR_PEOPLE)).toBeGreaterThan(0)
    // A person's request goes now, and so does the next.
    const one = spend(state, false, T0)
    expect(one).not.toBeNull()
    expect(waitMs(one ?? state, false, T0)).toBe(0)
    expect(spend(one ?? state, false, T0)).not.toBeNull()
  })

  it('lets the queue go again once the bucket holds one more than it keeps', () => {
    const { state } = drain(full(false), false, T0, burstCapacity(false))
    // 75 an hour is one every 48 seconds: six tokens is 288 seconds away.
    expect(waitMs(state, false, T0, KEPT_FOR_PEOPLE)).toBeCloseTo(
      (1 + KEPT_FOR_PEOPLE) * 48_000,
      -4,
    )
    const later = T0 + (1 + KEPT_FOR_PEOPLE) * 48_000 + 1_000
    expect(spend(state, false, later, KEPT_FOR_PEOPLE)).not.toBeNull()
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
    expect(woken.tokens).toBeCloseTo(7.5, 5)
  })

  it('caps a long sleep at the burst rather than banking the whole idle time', () => {
    // Half an hour earns 37.5, which is more than the bucket holds. Waking to
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
    expect(budgetPerHour(once, false)).toBe(37.5)
    // An hour of nothing but success: still halved.
    const later = refill(once, false, T0 + 10 * HOUR)
    expect(budgetPerHour(later, false)).toBe(37.5)
  })

  it('treats a burst of blocks as one incident', () => {
    const first = penalize(freshState(T0), T0)
    const second = penalize(first, T0 + 60_000)
    expect(budgetPerHour(second, false)).toBe(budgetPerHour(first, false))
  })

  it('cuts again for a genuinely separate incident', () => {
    const first = penalize(freshState(T0), T0)
    const second = penalize(first, T0 + 2 * HOUR)
    expect(budgetPerHour(second, false)).toBe(18.75)
  })

  it('never cuts the budget to nothing', () => {
    let state = freshState(T0)
    for (let i = 0; i < 20; i++) state = penalize(state, T0 + i * 2 * HOUR)
    expect(budgetPerHour(state, false)).toBeGreaterThan(0)
    expect(budgetPerHour(state, false)).toBeCloseTo(300 * 0.25 * (1 / 16), 5)
  })

  it('is undone only by asking', () => {
    const punished = penalize(freshState(T0), T0)
    expect(budgetPerHour(resetRatchet(punished, T0), false)).toBe(75)
  })
})

describe('signing in', () => {
  it('raises the budget at once without forgetting a past block', () => {
    const punished = penalize(freshState(T0), T0)
    expect(budgetPerHour(punished, true)).toBe(250)
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
