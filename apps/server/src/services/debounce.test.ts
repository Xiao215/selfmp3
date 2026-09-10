import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce.js'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('collapses a burst into one trailing call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.trigger()
    vi.advanceTimersByTime(50)
    d.trigger()
    vi.advanceTimersByTime(50)
    d.trigger()
    expect(fn).not.toHaveBeenCalled()
    expect(d.pending).toBe(true)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(d.pending).toBe(false)
  })

  it('still fires during a burst that never goes quiet', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100, 300)
    for (let i = 0; i < 10; i++) {
      d.trigger()
      vi.advanceTimersByTime(60)
    }
    // 600ms of continuous triggering with a 300ms ceiling -> at least one call.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(1)
    vi.advanceTimersByTime(200)
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('can be cancelled', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.trigger()
    d.cancel()
    expect(d.pending).toBe(false)
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })

  it('fires again after a fresh trigger', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.trigger()
    vi.advanceTimersByTime(100)
    d.trigger()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
