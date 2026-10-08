import { WrappedSchema, type Wrapped } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  emptyHint,
  emptyTitle,
  figure,
  longerRanges,
  shareFileName,
  tryLabel,
  weekdayName,
} from './wrapped.model'

const WRAPPED: Wrapped = WrappedSchema.parse({
  range: 'month',
  from: '2026-08-14T00:00:00.000Z',
  to: '2026-09-13T02:00:00.000Z',
  totals: { plays: 182, minutes: 330.4, songsPlayed: 13, activeDays: 4 },
  topSongs: [
    { songId: 3, title: '三原色', artist: 'YOASOBI', hasArt: true, plays: 46, minutes: 83.2 },
  ],
  topArtists: [{ key: 'YOASOBI', plays: 182, minutes: 330 }],
  topTags: [],
  peakHour: { hour: 23, plays: 16 },
  peakWeekday: { weekday: 6, plays: 145 },
  busiestDate: { date: '2026-09-12', plays: 145 },
  longestStreakDays: 4,
  mostInOneDay: null,
  discovered: [],
  personality: { traits: ['Repeat listener'], line: 'Repeat listener' },
})

describe('wrapped', () => {
  it('leads with the minutes', () => {
    expect(figure(330.4)).toBe('330')
  })

  it('names a weekday, and a dash for one it does not know', () => {
    expect(weekdayName(6)).toBe('Saturday')
    expect(weekdayName(9)).toBe('—')
  })

  it('offers only longer windows when one is empty', () => {
    expect(longerRanges('week')).toEqual(['month', 'quarter', 'year', 'all'])
    expect(longerRanges('all')).toEqual([])
    expect(tryLabel('year')).toBe('Try year')
    expect(tryLabel('quarter')).toBe('Try 3 months')
    expect(emptyHint('quarter')).toMatch(/last 3 months/)
    expect(emptyTitle('all')).toBe('Nothing in your history yet')
    expect(emptyTitle('week')).toBe('Nothing in this window yet')
    expect(emptyHint('week')).toMatch(/last 7 days/)
  })

  it('names the shared image by its window and day', () => {
    expect(shareFileName(WRAPPED)).toBe('selfmp3-report-month-2026-09-13.png')
  })
})
