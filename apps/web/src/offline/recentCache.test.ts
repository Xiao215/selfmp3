import { describe, expect, it } from 'vitest'
import { RECENT_BUDGET_BYTES, budgetFor, toEvict, type RecentCopy } from './recentCache.js'

/**
 * The budget for songs kept because they were played (recentCache.ts).
 *
 * What matters: a device with room keeps everything, one without lets go of
 * what was played longest ago, it stops the moment the rest fit, and the song
 * playing right now — the newest — is the last thing it would ever take.
 */

const copy = (songId: number, playedAt: number, bytes = 4_000_000): RecentCopy => ({
  songId,
  playedAt,
  bytes,
})

describe('letting go of songs kept because they were played', () => {
  it('keeps everything that fits, exactly to the last byte', () => {
    const copies = [copy(1, 10), copy(2, 20), copy(3, 30)]
    expect(toEvict(copies, 12_000_000)).toEqual([])
    expect(toEvict([], 0)).toEqual([])
  })

  it('lets go of what was played longest ago, and stops as soon as the rest fit', () => {
    const copies = [copy(3, 30), copy(1, 10), copy(4, 40), copy(2, 20)]
    expect(toEvict(copies, 8_000_000)).toEqual([1, 2])
  })

  it('never takes the one playing now before the ones played before it', () => {
    const copies = [copy(1, 10), copy(2, 20), copy(3, 30)]
    // Room for one: the two older ones go, the newest stays.
    expect(toEvict(copies, 4_000_000)).toEqual([1, 2])
  })

  it('decides the same way in two tabs when two were played in the same millisecond', () => {
    const copies = [copy(9, 10), copy(2, 10), copy(5, 10)]
    expect(toEvict(copies, 4_000_000)).toEqual([2, 5])
  })

  it('lets go of a song too big for the budget on its own', () => {
    expect(toEvict([copy(1, 10, 900_000_000)], 500_000_000)).toEqual([1])
  })

  it('counts a copy stored without a length as taking no room', () => {
    const copies = [copy(1, 10, 0), copy(2, 20, 600_000_000)]
    expect(toEvict(copies, 500_000_000)).toEqual([1, 2])
  })

  describe('how much of a device it may use', () => {
    it('is the cap on a browser that will not say how much room there is', () => {
      expect(budgetFor(null)).toBe(RECENT_BUDGET_BYTES)
      expect(budgetFor(0)).toBe(RECENT_BUDGET_BYTES)
      expect(budgetFor(Number.POSITIVE_INFINITY)).toBe(RECENT_BUDGET_BYTES)
    })

    it('is the cap on a roomy device, and a share of a small one', () => {
      expect(budgetFor(100 * 1024 * 1024 * 1024)).toBe(RECENT_BUDGET_BYTES)
      expect(budgetFor(400 * 1024 * 1024)).toBe(100 * 1024 * 1024)
    })
  })
})
