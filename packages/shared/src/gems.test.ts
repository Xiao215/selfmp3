import { describe, expect, it } from 'vitest'
import { forgottenGems, libraryAgeDays } from './gems.js'
import { toSqliteTime } from './sync.js'

const NOW = Date.parse('2026-09-23T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number): string => toSqliteTime(NOW - days * DAY)

const song = (id: number, added: number, plays: number, loved: boolean, last: number | null) => ({
  id,
  addedAt: daysAgo(added),
  playCount: plays,
  loved,
  lastPlayedAt: last === null ? null : daysAgo(last),
})

// Library is a year old, so the threshold is the 60-day ceiling.
const LIBRARY = [
  song(1, 365, 20, true, 120), // well loved, long quiet
  song(2, 365, 8, false, 90), // played a lot, quiet
  song(3, 365, 30, true, 2), // played recently
  song(4, 365, 2, false, 200), // barely played
  song(5, 100, 0, true, null), // loved, never played
  song(7, 365, 9, false, 59), // just under the line
]

describe('forgottenGems', () => {
  it('uses the oldest song as the library age', () => {
    expect(Math.round(libraryAgeDays(LIBRARY, NOW))).toBe(365)
    expect(forgottenGems(LIBRARY, { limit: 20, now: NOW }).minDays).toBe(60)
  })

  it('picks loved or well-played songs that have gone quiet, and nothing else', () => {
    const result = forgottenGems(LIBRARY, { limit: 20, now: NOW })
    // 3 is recent, 4 was never liked, 7 is one day short.
    expect(result.gems.map(gem => gem.song.id).sort((a, b) => a - b)).toEqual([1, 2, 5])
    expect(result.total).toBe(3)
  })

  it('ranks by plays times days since, within the random nudge', () => {
    // Song 1: 20 × 120 = 2400; song 2: 8 × 90 = 720; song 5: 1 × 100 = 100.
    // The nudge is at most ±25 %, so the order cannot flip.
    for (const random of [() => 0, () => 0.999]) {
      const { gems } = forgottenGems(LIBRARY, { limit: 20, now: NOW, random })
      expect(gems.map(gem => gem.song.id)).toEqual([1, 2, 5])
      expect(gems[0]?.daysSince).toBe(120)
      expect(gems[2]?.daysSince).toBe(100)
    }
  })

  it('honours the limit', () => {
    expect(forgottenGems(LIBRARY, { limit: 1, now: NOW }).gems).toHaveLength(1)
  })

  it('returns nothing on an empty library', () => {
    expect(libraryAgeDays([], NOW)).toBe(0)
    expect(forgottenGems([], { limit: 10, now: NOW })).toEqual({ gems: [], minDays: 14, total: 0 })
  })
})
