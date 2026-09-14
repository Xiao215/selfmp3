import { describe, expect, it } from 'vitest'

import {
  barShare,
  bestStreakHint,
  dailyColumns,
  daysLabel,
  formatHour,
  formatNumber,
  hourlyColumns,
  labelEvery,
  longDate,
  niceCeiling,
  peakHour,
  playsLabel,
  rangeButtonLabel,
  recentSongs,
  shortDate,
  STATS_RANGES,
} from './stats.model'

describe('stats ranges and labels', () => {
  it('offers five ranges, labelled in days, months and years', () => {
    expect(STATS_RANGES.map(rangeButtonLabel)).toEqual(['7d', '1m', '3m', '1y', 'All'])
  })

  it('names hours the way a clock face does', () => {
    expect([0, 6, 12, 13, 23].map(formatHour)).toEqual(['12am', '6am', '12pm', '1pm', '11pm'])
  })

  it('reads a date as the reader’s own day, and leaves nonsense alone', () => {
    expect(shortDate('2026-09-12')).toMatch(/12/)
    expect(longDate('2026-09-12')).toMatch(/Sep/)
    expect(shortDate('not a date')).toBe('not a date')
  })

  it('counts in words', () => {
    expect(daysLabel(1)).toBe('1 day')
    expect(daysLabel(4)).toBe('4 days')
    expect(playsLabel(1)).toBe('1 play')
    expect(bestStreakHint(4)).toBe('best: 4 days')
    expect(bestStreakHint(0)).toBeUndefined()
  })
})

describe('stats charts', () => {
  it('makes a column a day, with the full date for the tooltip', () => {
    const [day] = dailyColumns([{ date: '2026-09-12', plays: 145, minutes: 260 }])
    expect(day).toMatchObject({ value: 145 })
    expect(day!.detail).toMatch(/Sep/)
  })

  it('labels the hours every six, and names each hour’s span', () => {
    const hours = hourlyColumns(
      Array.from({ length: 24 }, (_, hour) => ({ hour, plays: hour === 23 ? 16 : 1 })),
    )
    expect(hours.filter(h => h.label).map(h => h.label)).toEqual(['12am', '6am', '12pm', '6pm'])
    expect(hours[23]!.detail).toBe('11pm–12am')
    expect(peakHour(hours.map((h, hour) => ({ hour, plays: h.value })))).toEqual({
      hour: 23,
      plays: 16,
    })
  })

  it('has no busiest hour without plays', () => {
    expect(peakHour([{ hour: 3, plays: 0 }])).toBeNull()
    expect(peakHour([])).toBeNull()
  })

  it('rounds an axis up to a number a person would pick', () => {
    expect([3, 7, 12, 145, 180, 420, 900].map(niceCeiling)).toEqual([
      5, 10, 15, 150, 200, 500, 1000,
    ])
    expect(formatNumber(75)).toBe('75')
    expect(formatNumber(7.5)).toBe('7.5')
    expect(formatNumber(Number.NaN)).toBe('0')
  })

  it('labels about seven columns whatever the range', () => {
    expect(labelEvery(7)).toBe(1)
    expect(labelEvery(30)).toBe(5)
    expect(labelEvery(365)).toBe(53)
  })

  it('keeps a bar visible however small', () => {
    expect(barShare(182, 182)).toBe(100)
    expect(barShare(1, 1000)).toBe(2)
  })
})

describe('recently played', () => {
  it('lists each song once, at its latest play', () => {
    const events = [{ songId: 1 }, { songId: 2 }, { songId: 1 }, { songId: 3 }]
    expect(recentSongs(events).map(e => e.songId)).toEqual([1, 2, 3])
  })
})
