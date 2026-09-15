import { WrappedSchema, type Wrapped } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

import {
  discoveredChapter,
  emptyHint,
  emptyTitle,
  eyebrow,
  facts,
  figure,
  figureUnit,
  longerRanges,
  numberOneLine,
  rankShare,
  repeatNote,
  shareFileName,
  showDiscovered,
  tryLabel,
  weekdayName,
  WRAPPED_RANGES,
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
  it('leads with the minutes, and the hours once there are some', () => {
    expect(eyebrow('month')).toBe('Last 30 days · you listened for')
    expect(figure(330.4)).toBe('330')
    expect(figureUnit(330.4)).toBe('minutes · 5 hr 30 min')
    expect(figureUnit(42)).toBe('minutes')
  })

  it('states six facts, with a dash where there is nothing to say', () => {
    expect(facts(WRAPPED)).toEqual([
      { label: 'Plays', value: '182' },
      { label: 'Songs', value: '13' },
      { label: 'Days with music', value: '4' },
      { label: 'Longest streak', value: '4 days' },
      { label: 'Peak hour', value: '11pm', hint: '16 plays' },
      { label: 'Best day', value: 'Saturday', hint: '145 plays' },
    ])
    const quiet = facts({ ...WRAPPED, peakHour: null, peakWeekday: null, longestStreakDays: 1 })
    expect(quiet.slice(3)).toEqual([
      { label: 'Longest streak', value: '1 day' },
      { label: 'Peak hour', value: '—', hint: undefined },
      { label: 'Best day', value: '—', hint: undefined },
    ])
    expect(weekdayName(9)).toBe('—')
  })

  it('offers only longer windows when one is empty', () => {
    expect(WRAPPED_RANGES).toEqual(['week', 'month', 'quarter', 'year', 'all'])
    expect(longerRanges('week')).toEqual(['month', 'quarter', 'year', 'all'])
    expect(longerRanges('all')).toEqual([])
    expect(tryLabel('year')).toBe('Try year')
    expect(tryLabel('quarter')).toBe('Try 3 months')
    expect(emptyHint('quarter')).toMatch(/last 3 months/)
    expect(emptyTitle('all')).toBe('Nothing in your history yet')
    expect(emptyTitle('week')).toBe('Nothing in this window yet')
    expect(emptyHint('week')).toMatch(/last 7 days/)
  })

  it('numbers Discovered after On repeat, when there is one', () => {
    expect(discoveredChapter(WRAPPED)).toBe('03')
    expect(
      discoveredChapter({
        mostInOneDay: {
          songId: 3,
          title: 'x',
          artist: '',
          hasArt: false,
          date: '2026-09-12',
          plays: 9,
        },
      }),
    ).toBe('04')
  })

  it('leaves Discovered out when it would repeat Top songs', () => {
    const song = (songId: number) => ({
      songId,
      title: `Song ${songId}`,
      artist: '',
      hasArt: false,
      plays: 3,
      minutes: 9,
    })
    const top = [song(1), song(2)]
    expect(showDiscovered({ topSongs: top, discovered: [song(1), song(2)] })).toBe(false)
    // The same songs in another order, one more, or one fewer: a different list.
    expect(showDiscovered({ topSongs: top, discovered: [song(2), song(1)] })).toBe(true)
    expect(showDiscovered({ topSongs: top, discovered: [song(1), song(2), song(3)] })).toBe(true)
    expect(showDiscovered({ topSongs: top, discovered: [song(1)] })).toBe(true)
    // Nothing discovered keeps its chapter, which says why.
    expect(showDiscovered({ topSongs: [], discovered: [] })).toBe(true)
  })

  it('draws a ranked bar for every row, never too thin to see', () => {
    expect(rankShare(182, 182)).toBe(100)
    expect(rankShare(1, 182)).toBe(6)
  })

  it('describes the number one and the day on repeat', () => {
    expect(numberOneLine({ plays: 46, minutes: 83.2 })).toBe('46 plays · 83 minutes')
    expect(repeatNote(WRAPPED)).toBe(
      'The most you played one song in a single day · busiest day overall: 145 plays.',
    )
    expect(repeatNote({ busiestDate: null })).toBe('The most you played one song in a single day.')
  })

  it('names the shared image by its window and day', () => {
    expect(shareFileName(WRAPPED)).toBe('selfmp3-wrapped-month-2026-09-13.png')
  })
})
