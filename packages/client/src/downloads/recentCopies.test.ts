import { describe, expect, it } from 'vitest'
import {
  RECENT_BUDGET_BYTES,
  budgetForDisk,
  parseKeptFiles,
  serialiseKeptFiles,
  toEvict,
  type RecentCopy,
} from './recentCopies.js'

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
    expect(toEvict(copies, 4_000_000)).toEqual([1, 2])
  })

  it('decides the same way every time when two were played in the same millisecond', () => {
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
})

/**
 * The cache as files.
 *
 * Two things are ways to lose track of a file: the budget comes from free space, which the cache itself eats, and a
 * copy is found by a name that stops being derivable once its song is gone.
 */
describe('a cache kept as files', () => {
  const GB = 1024 * 1024 * 1024

  it('takes a quarter of what would be free, up to the ceiling', () => {
    expect(budgetForDisk(40 * GB, 0)).toBe(RECENT_BUDGET_BYTES)
    expect(budgetForDisk(2 * GB, 0)).toBe(GB / 2)
  })

  it('does not shrink because of what it already holds', () => {
    // 1 GB free with 1 GB cached is the same device as 2 GB free with none:
    // otherwise every copy kept would be a reason to evict the one before it.
    expect(budgetForDisk(1 * GB, 1 * GB)).toBe(budgetForDisk(2 * GB, 0))
  })

  it('falls back to the ceiling when the device will not say', () => {
    expect(budgetForDisk(null, 0)).toBe(RECENT_BUDGET_BYTES)
    expect(budgetForDisk(Number.NaN, 0)).toBe(RECENT_BUDGET_BYTES)
  })

  it('reads back what it wrote', () => {
    const kept = new Map([[7, { playedAt: 1000, fileName: 'abc123.m4a', bytes: 4_000_000 }]])
    expect(parseKeptFiles(serialiseKeptFiles(kept))).toEqual(kept)
  })

  it('drops anything it could not safely delete later', () => {
    // The name is joined to a folder and removed, so a stored name that climbs
    // out of the folder is not one to keep — however it got there.
    const raw = JSON.stringify({
      1: { playedAt: 1, fileName: '../downloads.json', bytes: 1 },
      2: { playedAt: 1, fileName: 'songs/a.m4a', bytes: 1 },
      3: { playedAt: 'yesterday', fileName: 'a.m4a', bytes: 1 },
      4: { playedAt: 1, fileName: 'ok.m4a', bytes: 1 },
      nope: { playedAt: 1, fileName: 'b.m4a', bytes: 1 },
    })
    expect([...parseKeptFiles(raw).keys()]).toEqual([4])
  })

  it('starts again from a note it cannot read', () => {
    expect(parseKeptFiles('{half').size).toBe(0)
    expect(parseKeptFiles(null).size).toBe(0)
  })
})
