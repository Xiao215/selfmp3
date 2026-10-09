import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importPacer } from './importPacing.js'

/**
 * A run of imports' snapshots: the first soon, the rest further apart the
 * longer the run goes, and none owed left unpublished.
 */

const MINUTE = 60_000

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function counting() {
  const at: number[] = []
  const pacer = importPacer(() => at.push(Date.now()))
  return { pacer, at, start: Date.now() }
}

describe('the pace of a run of imports', () => {
  it('publishes the first snapshot of a run within a minute, once for a burst', () => {
    const { pacer, at, start } = counting()
    for (let song = 0; song < 5; song++) {
      pacer.trigger()
      vi.advanceTimersByTime(5_000)
    }
    vi.advanceTimersByTime(MINUTE)
    expect(at.map(time => time - start)).toEqual([45_000])
  })

  it('spaces the rest out further the longer the run goes, and leaves none owed', () => {
    const { pacer, at, start } = counting()
    // A song every ninety seconds for an hour: about YouTube's pace.
    for (let song = 0; song < 40; song++) {
      pacer.trigger()
      vi.advanceTimersByTime(90_000)
    }
    vi.advanceTimersByTime(15 * MINUTE)
    const gaps = at.slice(1).map((time, index) => time - (at[index] ?? start))
    // Never closer than two minutes, and ten apart by the end of the hour.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2 * MINUTE)
    expect(Math.max(...gaps)).toBe(10 * MINUTE)
    // The last song's snapshot still went up after it landed.
    expect(at.at(-1)).toBeGreaterThan(start + 39 * 90_000)
  })

  it('publishes about 150 snapshots on a thousand-song day, where it published about one a song', () => {
    const { pacer, at } = counting()
    for (let song = 0; song < 1_000; song++) {
      pacer.trigger()
      vi.advanceTimersByTime(86_400)
    }
    vi.advanceTimersByTime(15 * MINUTE)
    expect(at.length).toBeGreaterThan(140)
    expect(at.length).toBeLessThan(160)
  })

  it('starts quick again after the run ends, or pauses long enough', () => {
    const { pacer, at, start } = counting()
    pacer.trigger()
    vi.advanceTimersByTime(10_000)
    // The last song: the caller publishes it now.
    pacer.cancel()
    vi.advanceTimersByTime(MINUTE)
    expect(at).toEqual([])

    pacer.trigger()
    vi.advanceTimersByTime(MINUTE)
    expect(at.map(time => time - start)).toEqual([10_000 + MINUTE + 45_000])

    // Twenty quiet minutes later, a new run.
    vi.advanceTimersByTime(20 * MINUTE)
    const before = Date.now()
    pacer.trigger()
    vi.advanceTimersByTime(MINUTE)
    expect((at.at(-1) ?? 0) - before).toBe(45_000)
  })
})
