import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rateLimiter.js'

/** A clock the test advances by hand; sleeps are recorded, not waited for. */
function fakeClock() {
  let now = 1_000
  const sleeps: number[] = []
  return {
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
    advance: (ms: number) => {
      now += ms
    },
    sleeps,
  }
}

describe('RateLimiter', () => {
  it('lets the first call through immediately', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(1_000, clock)
    await limiter.acquire()
    expect(clock.sleeps).toEqual([])
  })

  it('spaces calls made at the same instant one interval apart', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(1_000, clock)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    expect(clock.sleeps).toEqual([1_000, 2_000])
  })

  it('gives concurrent callers distinct slots', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(1_000, clock)
    // All three call acquire() before any of them has awaited.
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()])
    expect(clock.sleeps).toEqual([1_000, 2_000])
  })

  it('does not wait when the interval has already elapsed', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(1_000, clock)
    await limiter.acquire()
    clock.advance(5_000)
    await limiter.acquire()
    expect(clock.sleeps).toEqual([])
  })

  it('only waits for the remainder of a partly elapsed interval', async () => {
    const clock = fakeClock()
    const limiter = new RateLimiter(1_000, clock)
    await limiter.acquire()
    clock.advance(400)
    await limiter.acquire()
    expect(clock.sleeps).toEqual([600])
  })
})
