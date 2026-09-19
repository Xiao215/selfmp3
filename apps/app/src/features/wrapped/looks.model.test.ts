import { WrappedSchema, type DailyPlays, type Wrapped } from '@selfmp3/shared'
import { lightPalette, tagColors } from '@selfmp3/client'
import { describe, expect, it } from 'vitest'

import {
  calendarGrid,
  calendarLook,
  clockHour,
  dateline,
  defaultLook,
  forecast,
  frontPageLook,
  hoursMinutes,
  lookInk,
  looksFor,
  lookToDraw,
  paperLook,
  receiptLook,
  repeatDetail,
  statsRangeOf,
  timeOfDay,
  timesWord,
  wallLook,
  WALL_TILES,
  weekdayOf,
  windowDays,
  wordsLook,
  wordsSentence,
  wordsSize,
  type LookInput,
} from './looks.model'

/*
 * Midday UTC, so the window's last day is the 19th in every time zone this
 * suite could run in.
 */
const WRAPPED: Wrapped = WrappedSchema.parse({
  range: 'month',
  from: '2026-08-21T04:00:00.000Z',
  to: '2026-09-19T12:00:00.000Z',
  totals: { plays: 128, minutes: 372.4, songsPlayed: 45, activeDays: 22 },
  topSongs: [
    { songId: 21, title: 'ノーチラス', artist: 'Yorushika', hasArt: true, plays: 14, minutes: 63 },
    {
      songId: 25,
      title: 'ヒッチコック',
      artist: 'Yorushika',
      hasArt: true,
      plays: 11,
      minutes: 44,
    },
    { songId: 2, title: 'アイドル', artist: 'YOASOBI', hasArt: true, plays: 9, minutes: 30 },
  ],
  topArtists: [
    { key: 'Yorushika', plays: 60, minutes: 181 },
    { key: 'YOASOBI', plays: 30, minutes: 108 },
  ],
  topTags: [
    { key: 'night drive', plays: 40, minutes: 124 },
    { key: 'yorushika', plays: 38, minutes: 112 },
    { key: 'chill', plays: 20, minutes: 58 },
    { key: 'study', plays: 5, minutes: 12 },
  ],
  peakHour: { hour: 23, plays: 30 },
  peakWeekday: { weekday: 6, plays: 40 },
  busiestDate: { date: '2026-09-05', plays: 18 },
  longestStreakDays: 9,
  // 5 September 2026 is a Saturday.
  mostInOneDay: {
    songId: 21,
    title: 'ノーチラス',
    artist: 'Yorushika',
    hasArt: true,
    date: '2026-09-05',
    plays: 6,
  },
  discovered: [{ songId: 7, title: 'New one', artist: 'Z', hasArt: false, plays: 3, minutes: 9 }],
  personality: {
    traits: ['Night owl', 'Repeat listener', 'Daily ritual'],
    line: 'Night owl · Repeat listener · Daily ritual',
  },
})

const DAILY: DailyPlays[] = [
  { date: '2026-08-21', plays: 4, minutes: 12 },
  { date: '2026-09-05', plays: 18, minutes: 60 },
  { date: '2026-09-19', plays: 6, minutes: 30 },
]

const INPUT: LookInput = { wrapped: WRAPPED, daily: DAILY }

const EMPTY: Wrapped = {
  ...WRAPPED,
  totals: { plays: 0, minutes: 0, songsPlayed: 0, activeDays: 0 },
  topSongs: [],
  topArtists: [],
  topTags: [],
  peakHour: null,
  peakWeekday: null,
  busiestDate: null,
  longestStreakDays: 0,
  mostInOneDay: null,
  discovered: [],
  personality: { traits: [], line: '' },
}

describe('which looks', () => {
  it('opens a computer on the front page and a phone on Paper', () => {
    expect(looksFor(true)).toEqual(['front', 'paper', 'receipt', 'wall', 'calendar', 'words'])
    expect(looksFor(false)).toEqual(['paper', 'receipt', 'wall', 'calendar', 'words'])
    expect(defaultLook(true)).toBe('front')
    expect(defaultLook(false)).toBe('paper')
  })

  it('keeps the chosen look while the width offers it', () => {
    expect(lookToDraw(null, true)).toBe('front')
    expect(lookToDraw('words', false)).toBe('words')
    // The front page on a window narrowed to a phone's width becomes Paper.
    expect(lookToDraw('front', false)).toBe('paper')
  })

  it('asks Stats for the same window', () => {
    expect(statsRangeOf('week')).toBe('7d')
    expect(statsRangeOf('all')).toBe('all')
  })
})

describe('words', () => {
  it('says when, how often and for how long the way a sentence would', () => {
    expect(timeOfDay(23)).toBe('at night')
    expect(timeOfDay(3)).toBe('at night')
    expect(timeOfDay(8)).toBe('in the morning')
    expect(timeOfDay(14)).toBe('in the afternoon')
    expect(timeOfDay(19)).toBe('in the evening')
    expect(timeOfDay(null)).toBeNull()
    expect(timesWord(1)).toBe('once')
    expect(timesWord(6)).toBe('six times')
    expect(timesWord(14)).toBe('14 times')
    expect(hoursMinutes(181)).toBe('3h 01')
    expect(hoursMinutes(42)).toBe('0h 42')
    expect(clockHour(9)).toBe('09:00')
  })

  it('tells the number one’s own day only when it was that song’s', () => {
    expect(weekdayOf('2026-09-05')).toBe(6)
    expect(repeatDetail(WRAPPED)).toBe('14 times, 6 of them on one Saturday')
    expect(
      repeatDetail({ ...WRAPPED, mostInOneDay: { ...WRAPPED.mostInOneDay!, songId: 2 } }),
    ).toBe('14 times')
    expect(repeatDetail(EMPTY)).toBeNull()
  })
})

describe('the window', () => {
  it('has exactly the days its label says', () => {
    expect(windowDays(INPUT)).toEqual({ first: '2026-08-21', last: '2026-09-19', count: 30 })
    expect(dateline(INPUT)).toBe('21 Aug – 19 Sep 2026')
  })

  it('starts all time at the first day anything was played', () => {
    const all = { wrapped: { ...WRAPPED, range: 'all' as const, from: null }, daily: DAILY }
    expect(windowDays(all).first).toBe('2026-08-21')
    expect(windowDays({ ...all, daily: [] })).toMatchObject({ first: '2026-09-19', count: 1 })
  })
})

describe('the calendar', () => {
  it('lays a month out a day a cell, under its weekday, the record day carrying its cover', () => {
    const grid = calendarGrid(INPUT)
    expect(grid.unit).toBe('day')
    expect(grid.columns).toBe(7)
    expect(grid.headers).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    // 21 August 2026 is a Friday: four blanks before it.
    expect(grid.cells.slice(0, 5).map(cell => cell?.label ?? null)).toEqual([
      null,
      null,
      null,
      null,
      '21',
    ])
    const days = grid.cells.filter(cell => cell !== null)
    expect(days).toHaveLength(30)
    const record = days.find(cell => cell.key === '2026-09-05')
    expect(record).toMatchObject({ share: 1, songId: 21, minutes: 60 })
    expect(days.find(cell => cell.key === '2026-09-19')?.share).toBe(0.5)
    expect(days.find(cell => cell.key === '2026-09-01')).toMatchObject({ share: 0, songId: null })
    expect(calendarLook(INPUT).caption).toBe(
      'A bigger dot is a longer day. The cover is the song you played most in a single day.',
    )
  })

  it('folds longer windows into weeks, then months, so it stays one picture', () => {
    const of = (range: Wrapped['range']) =>
      calendarGrid({ wrapped: { ...WRAPPED, range }, daily: DAILY })
    expect(of('week').cells).toHaveLength(7 + ((weekdayOf('2026-09-13') + 6) % 7))
    const quarter = of('quarter')
    expect(quarter.unit).toBe('week')
    expect(quarter.headers).toEqual([])
    expect(quarter.cells.length).toBeGreaterThanOrEqual(13)
    expect(quarter.cells.some(cell => cell?.songId === 21)).toBe(true)
    const year = of('year')
    expect(year.unit).toBe('month')
    expect(year.cells.map(cell => cell?.label)).toContain('Sep')
    expect(calendarGrid({ wrapped: EMPTY, daily: [] }).cells.every(c => !c || c.share === 0)).toBe(
      true,
    )
  })
})

describe('the looks', () => {
  it('prints Paper as P33 draws it', () => {
    expect(paperLook(INPUT)).toEqual({
      head: 'self.mp3 · This month',
      figure: '372',
      figureLine: 'minutes, mostly at night',
      onRepeat: {
        songId: 21,
        title: 'ノーチラス',
        line: 'Yorushika · 14 times, 6 of them on one Saturday',
      },
      figures: [
        { value: '128', label: 'plays' },
        { value: '9 days', label: 'longest streak' },
        { value: '11pm', label: 'peak hour' },
      ],
      tags: ['night drive', 'yorushika', 'chill'],
      traits: 'Night owl · Repeat listener · Daily ritual',
    })
    expect(paperLook({ wrapped: EMPTY, daily: [] })).toMatchObject({
      figureLine: 'minutes',
      onRepeat: null,
    })
  })

  it('itemises the receipt, with the rest on one line', () => {
    const receipt = receiptLook(INPUT)
    expect(receipt.sub).toBe('THIS MONTH · 21 AUG – 19 SEP 2026')
    expect(receipt.items).toEqual([
      { name: 'ノーチラス', value: 'x14' },
      { name: 'ヒッチコック', value: 'x11' },
      { name: 'アイドル', value: 'x9' },
      { name: '...and 42 more', value: 'x94' },
    ])
    expect(receipt.lines).toEqual([
      { name: 'PLAYS', value: '128' },
      { name: 'DAYS WITH MUSIC', value: '22 / 30' },
      { name: 'LONGEST STREAK', value: '9 DAYS' },
      { name: 'PEAK HOUR', value: '23:00' },
    ])
    expect(receipt.total).toBe('372 min')
    expect(receipt.bars).toHaveLength(30)
    expect(receipt.footer).toEqual(['NIGHT OWL · REPEAT LISTENER', 'THANK YOU FOR LISTENING'])
    expect(receiptLook({ wrapped: EMPTY, daily: [] }).footer).toEqual(['THANK YOU FOR LISTENING'])
  })

  it('tiles the wall with every song the period names, repeating to fill it', () => {
    const wall = wallLook(INPUT)
    expect(wall.tiles).toHaveLength(WALL_TILES)
    expect(wall.tiles.slice(0, 5).map(tile => tile.songId)).toEqual([21, 25, 2, 7, 21])
    expect(wall.line).toBe('minutes across 45 songs, mostly at night')
    expect(wall.figures).toEqual([
      { value: '128', label: 'plays' },
      { value: '9', label: 'day streak' },
      { value: 'ノーチラス', label: '×14' },
    ])
    expect(wall.foot).toBe('self.mp3 · 2026')
    expect(wallLook({ wrapped: EMPTY, daily: [] }).tiles).toEqual([])
  })

  it('writes the period as one sentence, larger the shorter it is', () => {
    const sentence = wordsSentence(WRAPPED)
    expect(sentence.map(segment => segment.text).join('')).toBe(
      'You listened for 372 minutes, mostly at night, mostly Yorushika, and one Saturday you played ノーチラス six times.',
    )
    expect(sentence.filter(segment => segment.em).map(segment => segment.text)).toEqual([
      '372 minutes',
      'Yorushika',
      'ノーチラス',
    ])
    expect(wordsSize(sentence)).toBe(50)
    expect(wordsSize([{ text: 'x'.repeat(140), em: false }])).toBe(42)
    expect(wordsSize([{ text: 'Short.', em: false }])).toBe(50)
    expect(wordsSize([{ text: 'x'.repeat(260), em: false }])).toBe(30)
    expect(
      wordsSentence(EMPTY)
        .map(segment => segment.text)
        .join(''),
    ).toBe('You listened for 0 minutes.')
    expect(wordsLook(INPUT)).toMatchObject({
      foot: '128 plays · 22 days · a 9 day streak',
      tags: ['night drive', 'yorushika'],
      songId: 21,
    })
  })

  it('sets the front page like a newspaper', () => {
    const front = frontPageLook(INPUT)
    expect(front.masthead).toBe('The Monthly')
    expect(front.gridTitle).toBe('The month, day by day')
    expect(frontPageLook({ ...INPUT, wrapped: { ...WRAPPED, range: 'year' } }).gridTitle).toBe(
      'The year, month by month',
    )
    expect(front.headline).toBe('Listener logs 372 minutes, most of them after dark')
    expect(front.deck).toBe(
      'This month came to 128 plays across 22 days. The busiest hour was 11pm. The longest run was 9 days in a row.',
    )
    expect(front.photo).toEqual({
      songId: 21,
      caption: 'On repeat: ノーチラス, played 14 times, 6 of them on one Saturday.',
    })
    expect(front.charts.map(chart => chart.title)).toEqual(['The charts', 'By artist', 'By tag'])
    expect(front.charts[1]?.rows[0]).toEqual({ name: 'Yorushika', value: '3h 01' })
    expect(front.forecast).toEqual({
      title: 'Night owl, with a chance of repeats',
      line: 'Peak 23:00 · busiest on Saturdays',
    })
    expect(forecast(EMPTY)).toEqual({ title: 'Settled, with music', line: '' })
    expect(frontPageLook({ wrapped: EMPTY, daily: [] }).charts).toEqual([])
  })
})

describe('colour', () => {
  it('prints the paper looks in Paper’s inks and Words on the accent’s tile, at any theme', () => {
    const paper = lightPalette(268)
    expect(lookInk('paper', 268)).toMatchObject({
      ground: paper.surface0,
      ink: paper.textPrimary,
      accent: paper.accent,
    })
    expect(lookInk('receipt', 268).ground).toBe(paper.surface1)
    expect(lookInk('words', 200).ground).toBe(tagColors(200, 'dark').tile)
    expect(lookInk('words', 200).accent).toBe(tagColors(200, 'dark').tileInk)
  })
})
