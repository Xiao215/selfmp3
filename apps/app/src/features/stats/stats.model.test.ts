import { describe, expect, it, vi } from 'vitest'
import type { Stats } from '@selfmp3/shared'

import {
  artistCoverSong,
  bestStreakHint,
  daysLabel,
  formatHour,
  isStatsPeriod,
  listenedCard,
  peakCard,
  peakHour,
  peakHourWords,
  periodLabel,
  playsLabel,
  rankedArtists,
  rankedEmpty,
  rankedRows,
  rankedSongs,
  rankedTags,
  sparkPath,
  spanWords,
  statFigures,
  STATS_PERIODS,
  statsRangeFor,
  streakCard,
} from './stats.model'

const stats = (over: Partial<Stats> = {}): Stats => ({
  range: '30d',
  totals: {
    plays: 128,
    minutes: 372,
    songsPlayed: 30,
    librarySize: 45,
    libraryMinutes: 180,
    neverPlayed: 4,
  },
  streakDays: 0,
  longestStreakDays: 0,
  daily: [],
  hourly: [],
  topArtists: [],
  topTags: [],
  topSongs: [],
  ...over,
})

describe('stats windows and words', () => {
  it('offers five windows, as the stats endpoint names them', () => {
    expect(STATS_PERIODS.map(periodLabel)).toEqual([
      'Week',
      'Month',
      '3 months',
      'Year',
      'All time',
    ])
    expect(STATS_PERIODS.map(statsRangeFor)).toEqual(['7d', '30d', '90d', '365d', 'all'])
  })

  it('reads a window from an address, and nothing else', () => {
    expect(isStatsPeriod('week')).toBe(true)
    expect(isStatsPeriod('fortnight')).toBe(false)
    expect(isStatsPeriod(undefined)).toBe(false)
  })

  it('names hours the way a clock face does', () => {
    expect([0, 6, 12, 13, 23].map(formatHour)).toEqual(['12am', '6am', '12pm', '1pm', '11pm'])
  })

  it('counts in words', () => {
    expect(daysLabel(1)).toBe('1 day')
    expect(daysLabel(4)).toBe('4 days')
    expect(playsLabel(1)).toBe('1 play')
    expect(bestStreakHint(4)).toBe('best: 4 days')
    expect(bestStreakHint(0)).toBeUndefined()
  })
})

describe('the cards', () => {
  it('Listened: the time, the plays and the days with any', () => {
    const card = listenedCard(
      stats({
        daily: [
          { date: '2026-09-12', plays: 3, minutes: 11 },
          { date: '2026-09-13', plays: 0, minutes: 0 },
          { date: '2026-09-14', plays: 1, minutes: 4 },
        ],
      }),
    )
    expect(card.value).toBe('6h 12')
    expect(card.line).toBe('128 plays · 2 days')
    expect(card.trend).toEqual([11, 0, 4])
  })

  it('Peak hour: the busiest hour, what it says, and every hour as a share of it', () => {
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: hour === 23 ? 16 : 4 }))
    const card = peakCard(hourly)
    expect(card).toMatchObject({ value: '11pm', words: 'Night owl', peak: 23 })
    expect(card.bars).toHaveLength(24)
    expect(card.bars[23]).toBe(1)
    expect(card.bars[0]).toBe(0.25)
  })

  it('Peak hour says nothing without a play', () => {
    expect(peakHour([{ hour: 3, plays: 0 }])).toBeNull()
    expect(peakCard([])).toMatchObject({ value: null, words: null, peak: null })
  })

  it('names the busiest hour in the Report’s bands', () => {
    expect([23, 2, 6, 13, 19].map(peakHourWords)).toEqual([
      'Night owl',
      'Night owl',
      'Early bird',
      'Daytime listener',
      'Evening listener',
    ])
  })

  it('Streak: the run still going, ending today or yesterday, among the window’s days', () => {
    const today = new Date(2026, 8, 14)
    const daily = ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map(date => ({
      date,
      plays: 2,
      minutes: 8,
    }))
    // Nothing yet today: the run ends yesterday and is still going.
    const card = streakCard(
      {
        range: '30d',
        daily: [...daily, { date: '2026-09-14', plays: 0, minutes: 0 }],
        streakDays: 4,
        longestStreakDays: 9,
      },
      today,
    )
    expect(card.value).toBe('4 days')
    expect(card.line).toBe(spanWords(new Date(2026, 8, 10), new Date(2026, 8, 13)))
    expect(card.squares).toHaveLength(5)
    expect(card.squares.at(-1)).toEqual({
      date: '2026-09-14',
      played: false,
      inRun: false,
      today: true,
    })
    expect(card.squares.filter(square => square.played)).toHaveLength(4)
    expect(card.squares.filter(square => square.inRun)).toHaveLength(4)
    expect(card.from).toMatch(/^Sep\w* 10$/)
  })

  it('Streak: days played before the run are filled but not part of it', () => {
    const today = new Date(2026, 8, 14)
    const card = streakCard(
      {
        range: '7d',
        daily: [
          '2026-09-08',
          '2026-09-09',
          '2026-09-10',
          '2026-09-11',
          '2026-09-12',
          '2026-09-13',
          '2026-09-14',
        ].map(date => ({ date, plays: date === '2026-09-11' ? 0 : 1, minutes: 3 })),
        streakDays: 3,
        longestStreakDays: 3,
      },
      today,
    )
    expect(card.squares.map(square => [square.played, square.inRun])).toEqual([
      [true, false],
      [true, false],
      [true, false],
      [false, false],
      [true, true],
      [true, true],
      [true, true],
    ])
  })

  it('Streak with no run shows the best one, and All time shows a month of days', () => {
    const card = streakCard(
      { range: 'all', daily: [], streakDays: 0, longestStreakDays: 6 },
      new Date(2026, 8, 14),
    )
    expect(card.line).toBe('best: 6 days')
    expect(card.squares).toHaveLength(30)
  })

  it('Streak over a year is a strip of weeks, a week lit by any day in it', () => {
    const card = streakCard(
      {
        range: '365d',
        daily: [{ date: '2026-09-02', plays: 1, minutes: 3 }],
        streakDays: 0,
        longestStreakDays: 1,
      },
      new Date(2026, 8, 14),
    )
    expect(card.squares).toHaveLength(52)
    // Sep 8 to 14 is the last week, Sep 1 to 7 the one before it.
    expect(card.squares.map(square => square.played).lastIndexOf(true)).toBe(50)
    expect(card.squares.at(-1)?.today).toBe(true)
  })

  it('says a span of days with the month once when it is one month', () => {
    const sep = (day: number) => new Date(2026, 8, day)
    expect(spanWords(sep(6), sep(14))).toBe('Sep 6 to 14')
    expect(spanWords(new Date(2026, 7, 30), sep(3))).toBe('Aug 30 to Sep 3')
    expect(spanWords(sep(14), sep(14))).toBe('Sep 14')
  })

  it("says its months in English whatever language the reader's device is in", () => {
    // A reader whose device is set to Chinese: the default locale is theirs.
    const own = Date.prototype.toLocaleDateString
    const spy = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      locales,
      options,
    ) {
      return own.call(this, locales ?? 'zh-CN', options)
    })
    try {
      expect(spanWords(new Date(2026, 9, 5), new Date(2026, 9, 25))).toBe('Oct 5 to 25')
      const card = streakCard(
        { range: '90d', daily: [], streakDays: 0, longestStreakDays: 0 },
        new Date(2026, 9, 25),
      )
      expect(card.from).toBe('Jul 27')
    } finally {
      spy.mockRestore()
    }
  })

  it('says the year a run began when it was another year', () => {
    expect(spanWords(new Date(2023, 11, 30), new Date(2026, 9, 25))).toMatch(
      /^Dec\w* 30, 2023 to Oct\w* 25$/,
    )
    expect(spanWords(new Date(2025, 11, 30), new Date(2026, 0, 2))).toMatch(
      /^Dec\w* 30, 2025 to Jan\w* 2$/,
    )
  })

  it('draws the trend as one stroke across the box, flat when there is nothing to draw', () => {
    expect(sparkPath([], 120, 56)).toBe('M3 28 L117 28')
    const path = sparkPath([0, 10, 5], 120, 56)
    expect(path.split(' L')).toHaveLength(3)
    expect(path.startsWith('M3 53')).toBe(true)
    expect(path).toContain('L60 3')
  })
})

describe('the ranked module', () => {
  it('ranks songs by plays, the unit said once, each bar a share of the first', () => {
    const rows = rankedSongs([
      { songId: 7, title: 'ノーチラス', artist: 'ヨルシカ', hasArt: true, plays: 14, minutes: 60 },
      { songId: 9, title: 'ヒッチコック', artist: 'ヨルシカ', hasArt: true, plays: 7, minutes: 30 },
    ])
    expect(rows.map(row => [row.rank, row.name, row.trailing, row.share])).toEqual([
      [1, 'ノーチラス', '14 plays', 1],
      [2, 'ヒッチコック', '7', 0.5],
    ])
    expect(rows[0]).toMatchObject({ kind: 'song', songId: 7, artist: 'ヨルシカ' })
  })

  it('ranks artists by time, and marks the unknown artist as no place to open', () => {
    const rows = rankedArtists([
      { key: 'Yorushika', plays: 10, minutes: 181 },
      { key: 'suis', plays: 4, minutes: 100 },
      { key: 'YOASOBI', plays: 5, minutes: 108 },
      { key: 'Unknown artist', plays: 1, minutes: 3 },
    ])
    expect(rows.map(row => [row.name, row.trailing])).toEqual([
      ['Yorushika', '3h 01'],
      ['YOASOBI', '1h 48'],
      ['suis', '1h 40'],
      ['Unknown artist', '3 min'],
    ])
    // A song with no artist is listed but is not a place to open.
    expect(rows.map(row => row.kind === 'artist' && row.known)).toEqual([true, true, true, false])
  })

  it('ranks tags by time, and caps every list', () => {
    const top = Array.from({ length: 8 }, (_, index) => ({
      key: `tag ${index}`,
      plays: 1,
      minutes: index * 10,
    }))
    const rows = rankedTags(top)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ kind: 'tag', name: 'tag 7', trailing: '1h 10', share: 1 })
    expect(rankedRows(stats({ topTags: top }), 'tags', 3)).toHaveLength(3)
    expect(rankedRows(stats(), 'songs')).toEqual([])
  })

  it('says why a list is empty', () => {
    expect(rankedEmpty('tags')).toMatch(/tagged/)
    expect(rankedEmpty('songs')).toMatch(/Nothing played/)
  })
})

describe('an artist with no picture', () => {
  const song = (artist: string, hasArt = true, title = artist) => ({ title, artist, hasArt })

  it('wears the cover of theirs played most, a collaboration counting as theirs', () => {
    const played = [
      song('YOASOBI', true, 'アイドル'),
      song('n-buna feat. suis', true, '花に亡霊'),
      song('suis', true, 'later'),
    ]
    expect(artistCoverSong('suis', played, [])?.title).toBe('花に亡霊')
  })

  it('passes over a played song without a cover, then turns to the library', () => {
    const played = [song('Akane', false, 'Kokoronashi')]
    const library = [song('YOASOBI'), song('akane', true, 'another')]
    expect(artistCoverSong('Akane', played, library)?.title).toBe('another')
    expect(artistCoverSong('Nobody', played, library)).toBeUndefined()
  })
})

describe('the three headline numbers, on Home and You alike', () => {
  it('writes a whole hour as "2h", not "2h 00"', () => {
    const totals = stats().totals
    expect(statFigures(stats({ totals: { ...totals, minutes: 120 } })).listened).toBe('2h')
    expect(statFigures(stats({ totals: { ...totals, minutes: 185 } })).listened).toBe('3h 05')
  })

  it('sets minutes apart from their word', () => {
    expect(statFigures(stats({ totals: { ...stats().totals, minutes: 42 } }))).toMatchObject({
      listened: '42',
      listenedUnit: 'min',
    })
  })

  it('groups plays and the streak as the reader does', () => {
    const figures = statFigures(
      stats({ totals: { ...stats().totals, plays: 1234 }, streakDays: 1 }),
    )
    expect(figures.plays).toBe((1234).toLocaleString())
    expect(figures.plays).not.toBe('1234')
    expect(figures.streak).toBe('1')
    expect(figures.streakUnit).toBe('day')
    expect(figures.playsCaption).toBe('plays')
  })

  it('says one play, and under a minute for a few seconds', () => {
    const figures = statFigures(stats({ totals: { ...stats().totals, plays: 1, minutes: 0.1 } }))
    expect(figures).toMatchObject({
      plays: '1',
      playsCaption: 'play',
      listened: '<1',
      listenedUnit: 'min',
    })
  })
})
