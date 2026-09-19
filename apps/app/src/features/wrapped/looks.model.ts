import {
  WRAPPED_RANGE_DAYS,
  type DailyPlays,
  type StatsRange,
  type Wrapped,
  type WrappedRange,
} from '@selfmp3/shared'
import { darkPalette, lightPalette, tagColors } from '@selfmp3/client'
import { formatHour, playsLabel } from '../stats/stats.model'
import { figure, weekdayName } from './wrapped.model'

/**
 * The month as a page (docs/ui-mock `P33`–`P37`, `C16`), without the screen.
 *
 * One period, drawn as one picture in a look of your choosing. Every look is a
 * function from the same `LookInput` to what it prints — which facts, which
 * words, the receipt's lines, the calendar's cells — and a component that
 * draws only that. A sixth look is a function here, a component beside the
 * others and a line in `LOOK_VIEWS` (looks/index.ts); nothing else has to learn it
 * exists.
 *
 * The numbers are Wrapped's. The one thing Wrapped does not carry is the day
 * by day shape of the window, which the receipt's bars, the calendar and the
 * front page's grid need, so those come from Stats' `daily` for the same
 * window. Without it they draw every day as empty rather than guess.
 */

export type LookId = 'front' | 'paper' | 'receipt' | 'wall' | 'calendar' | 'words'

export const LOOK_LABELS: Record<LookId, string> = {
  front: 'Front page',
  paper: 'Paper',
  receipt: 'Receipt',
  wall: 'Wall',
  calendar: 'Calendar',
  words: 'Words',
}

/** The five every device offers, in `P33`'s order. */
const FIVE: readonly LookId[] = ['paper', 'receipt', 'wall', 'calendar', 'words']

/**
 * A computer adds the newspaper front page and opens on it (`C16`); a phone
 * has no room for three columns and opens on Paper.
 */
export function looksFor(wide: boolean): readonly LookId[] {
  return wide ? ['front', ...FIVE] : FIVE
}

export function defaultLook(wide: boolean): LookId {
  return wide ? 'front' : 'paper'
}

/**
 * The look to draw: the one chosen, while this width offers it. A window
 * narrowed below the breakpoint on the front page falls back to Paper rather
 * than drawing three columns on a phone.
 */
export function lookToDraw(chosen: LookId | null, wide: boolean): LookId {
  return chosen !== null && looksFor(wide).includes(chosen) ? chosen : defaultLook(wide)
}

/** What every look is drawn from. */
export interface LookInput {
  readonly wrapped: Wrapped
  /** Stats' day by day for the same window; empty until it arrives. */
  readonly daily: readonly DailyPlays[]
}

/** Stats names the same windows differently; `daily` is asked for by its name. */
const STATS_RANGE: Record<WrappedRange, StatsRange> = {
  week: '7d',
  month: '30d',
  quarter: '90d',
  year: '365d',
  all: 'all',
}

export function statsRangeOf(range: WrappedRange): StatsRange {
  return STATS_RANGE[range]
}

// --- words every look shares ---------------------------------------------------

/**
 * What the period is called on the page. The windows are rolling — the month
 * is the last thirty days, not September — so a calendar month's name would be
 * wrong for most of it. "This month" is what the You page says of the same
 * thirty days.
 */
const PERIOD_TITLES: Record<WrappedRange, string> = {
  week: 'This week',
  month: 'This month',
  quarter: 'Three months',
  year: 'This year',
  all: 'All time',
}

function periodTitle(range: WrappedRange): string {
  return PERIOD_TITLES[range]
}

/** The front page's masthead. */
const MASTHEADS: Record<WrappedRange, string> = {
  week: 'The Weekly',
  month: 'The Monthly',
  quarter: 'The Quarterly',
  year: 'The Annual',
  all: 'The Almanac',
}

export function masthead(range: WrappedRange): string {
  return MASTHEADS[range]
}

/**
 * When most of the listening happened, as the rest of a sentence: "at night".
 * Null with no plays, so a sentence can leave the clause out.
 */
export function timeOfDay(hour: number | null | undefined): string | null {
  if (hour === null || hour === undefined) return null
  if (hour >= 21 || hour < 5) return 'at night'
  if (hour < 12) return 'in the morning'
  if (hour < 17) return 'in the afternoon'
  return 'in the evening'
}

/** The front page's headline says it the way a newspaper would. */
function timeOfDayHeadline(hour: number | null | undefined): string | null {
  const when = timeOfDay(hour)
  if (when === null) return null
  return when === 'at night' ? 'after dark' : when
}

const COUNT_WORDS = [
  '',
  'once',
  'twice',
  'three times',
  'four times',
  'five times',
  'six times',
  'seven times',
  'eight times',
  'nine times',
  'ten times',
  'eleven times',
  'twelve times',
]

/** "once", "twice", "six times", "14 times": a number the way it is said. */
export function timesWord(count: number): string {
  return COUNT_WORDS[count] ?? `${count.toLocaleString()} times`
}

/** "372 minutes" ("1 minute"). */
function minutesPhrase(minutes: number): string {
  const whole = Math.round(minutes)
  return `${whole.toLocaleString()} ${whole === 1 ? 'minute' : 'minutes'}`
}

/** "3h 01": an artist's or a tag's time, as a chart column prints it. */
export function hoursMinutes(minutes: number): string {
  const whole = Math.round(minutes)
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}`
}

/** "23:00": the receipt prints the clock, not "11pm". */
export function clockHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

const days = (count: number): string => `${count.toLocaleString()} ${count === 1 ? 'day' : 'days'}`

/**
 * "14 times, 6 of them on one Saturday": how the number one was played, and
 * the day it was played most when that day was its own.
 */
export function repeatDetail(wrapped: Pick<Wrapped, 'topSongs' | 'mostInOneDay'>): string | null {
  const top = wrapped.topSongs[0]
  if (!top) return null
  const record = wrapped.mostInOneDay
  const onOneDay =
    record && record.songId === top.songId && record.plays > 1 && record.plays < top.plays
      ? `, ${record.plays} of them on one ${weekdayName(weekdayOf(record.date))}`
      : ''
  return `${timesWord(top.plays)}${onOneDay}`
}

// --- dates ---------------------------------------------------------------------

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/*
 * Dates are the server's YYYY-MM-DD, and arithmetic on them is done at UTC
 * midnight, where every day is 24 hours long: a window that crosses a clock
 * change would otherwise gain or lose a day.
 */
function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function fromUtc(ms: number): string {
  const at = new Date(ms)
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`
}

/** 0 = Sunday, as Wrapped counts weekdays. */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay()
}

/** The day an ISO timestamp falls on, here. */
function localDay(iso: string): string {
  const at = new Date(iso)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

/**
 * The window's first and last day. Counted back from the last by the range's
 * length rather than read off `from`, so the window has exactly the days its
 * label says; all time starts at the first day anything was played.
 */
export function windowDays(input: LookInput): { first: string; last: string; count: number } {
  const last = localDay(input.wrapped.to)
  const length = WRAPPED_RANGE_DAYS[input.wrapped.range]
  const earliest = input.daily.reduce<string | null>(
    (min, day) => (min === null || day.date < min ? day.date : min),
    null,
  )
  const first =
    length !== null
      ? fromUtc(toUtc(last) - (length - 1) * DAY_MS)
      : earliest !== null && earliest < last
        ? earliest
        : last
  return { first, last, count: Math.round((toUtc(last) - toUtc(first)) / DAY_MS) + 1 }
}

function shortDay(date: string): string {
  const at = new Date(toUtc(date))
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`
}

/** "21 Aug – 19 Sep 2026": the window, as a dateline. */
export function dateline(input: LookInput): string {
  const { first, last } = windowDays(input)
  const year = last.slice(0, 4)
  return first === last
    ? `${shortDay(last)} ${year}`
    : `${shortDay(first)} – ${shortDay(last)} ${year}`
}

// --- the calendar ----------------------------------------------------------------

interface CalendarCell {
  readonly key: string
  /** The day of the month, or the week's first day, or the month's name. */
  readonly label: string
  readonly minutes: number
  /** Of the longest cell, 0 to 1: a bigger dot is a longer day. */
  readonly share: number
  /** The song played most in one day, on the cell that day is in. */
  readonly songId: number | null
}

interface CalendarGrid {
  readonly unit: 'day' | 'week' | 'month' | 'year'
  readonly columns: number
  /** Over the columns: the weekdays, for a grid of days. */
  readonly headers: readonly string[]
  /** Row by row; null is a blank before the first day, so days sit under their weekday. */
  readonly cells: readonly (CalendarCell | null)[]
}

/*
 * One cell per day while a month's worth fits in six rows of seven. Longer
 * windows fold into weeks, then months, then years, so the grid stays one
 * picture: a year of days is fifty-three rows, which is not a calendar but a
 * scroll.
 */
const MAX_DAYS = 42
const MAX_WEEKS = 42
const MAX_MONTHS = 36

export function calendarGrid(input: LookInput): CalendarGrid {
  const { first, count } = windowDays(input)
  const minutesOn = new Map(input.daily.map(day => [day.date, day.minutes]))
  const record = input.wrapped.mostInOneDay
  const dates = Array.from({ length: count }, (_, i) => fromUtc(toUtc(first) + i * DAY_MS))

  const weeks = new Set(dates.map(mondayOf)).size
  const months = new Set(dates.map(date => date.slice(0, 7))).size
  const unit: CalendarGrid['unit'] =
    count <= MAX_DAYS
      ? 'day'
      : weeks <= MAX_WEEKS
        ? 'week'
        : months <= MAX_MONTHS
          ? 'month'
          : 'year'

  // Buckets in date order; a Map keeps the order they were first seen in.
  const bucketOf = (date: string): string =>
    unit === 'day'
      ? date
      : unit === 'week'
        ? mondayOf(date)
        : unit === 'month'
          ? date.slice(0, 7)
          : date.slice(0, 4)
  const buckets = new Map<string, { minutes: number; songId: number | null }>()
  for (const date of dates) {
    const key = bucketOf(date)
    const bucket = buckets.get(key) ?? { minutes: 0, songId: null }
    bucket.minutes += minutesOn.get(date) ?? 0
    if (record && record.date === date) bucket.songId = record.songId
    buckets.set(key, bucket)
  }

  const longest = Math.max(0, ...[...buckets.values()].map(bucket => bucket.minutes))
  const cells: (CalendarCell | null)[] = [...buckets].map(([key, bucket]) => ({
    key,
    label: cellLabel(unit, key),
    minutes: bucket.minutes,
    share: longest > 0 ? bucket.minutes / longest : 0,
    songId: bucket.songId,
  }))

  if (unit === 'day') {
    // Monday first, as `P36` draws it.
    const blanks = (weekdayOf(first) + 6) % 7
    return {
      unit,
      columns: 7,
      headers: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
      cells: [...Array<null>(blanks).fill(null), ...cells],
    }
  }
  return { unit, columns: unit === 'week' ? 7 : 6, headers: [], cells }
}

function mondayOf(date: string): string {
  return fromUtc(toUtc(date) - ((weekdayOf(date) + 6) % 7) * DAY_MS)
}

function cellLabel(unit: CalendarGrid['unit'], key: string): string {
  if (unit === 'day') return String(Number(key.slice(8, 10)))
  if (unit === 'week') return shortDay(key)
  if (unit === 'month') return MONTHS[Number(key.slice(5, 7)) - 1] ?? key
  return key
}

/** What a calendar's dots mean, said under it. */
function calendarCaption(grid: CalendarGrid): string {
  const longer = `A bigger dot is a longer ${grid.unit}.`
  const covered = grid.cells.some(cell => cell?.songId != null)
  return covered ? `${longer} The cover is the song you played most in a single day.` : longer
}

// --- the looks -------------------------------------------------------------------

export interface Figure {
  readonly value: string
  readonly label: string
}

interface NumberOne {
  readonly songId: number
  readonly title: string
  /** "Yorushika · 14 times, 6 of them on one Saturday". */
  readonly line: string
}

function numberOne(wrapped: Wrapped): NumberOne | null {
  const top = wrapped.topSongs[0]
  if (!top) return null
  return {
    songId: top.songId,
    title: top.title,
    line: `${top.artist || 'Unknown artist'} · ${repeatDetail(wrapped) ?? ''}`,
  }
}

/** Paper (`P33`): the minutes, the song on repeat, three figures, the tags, the traits. */
export interface PaperLook {
  readonly head: string
  readonly figure: string
  /** "minutes, mostly at night". */
  readonly figureLine: string
  readonly onRepeat: NumberOne | null
  readonly figures: readonly Figure[]
  readonly tags: readonly string[]
  readonly traits: string
}

export function paperLook({ wrapped }: LookInput): PaperLook {
  const when = timeOfDay(wrapped.peakHour?.hour)
  const unit = Math.round(wrapped.totals.minutes) === 1 ? 'minute' : 'minutes'
  return {
    head: `self.mp3 · ${periodTitle(wrapped.range)}`,
    figure: figure(wrapped.totals.minutes),
    figureLine: when ? `${unit}, mostly ${when}` : unit,
    onRepeat: numberOne(wrapped),
    figures: [
      { value: wrapped.totals.plays.toLocaleString(), label: 'plays' },
      { value: days(wrapped.longestStreakDays), label: 'longest streak' },
      { value: wrapped.peakHour ? formatHour(wrapped.peakHour.hour) : '—', label: 'peak hour' },
    ],
    tags: wrapped.topTags.slice(0, 3).map(tag => tag.key),
    traits: wrapped.personality.line,
  }
}

export interface ReceiptLine {
  readonly name: string
  readonly value: string
}

/** Receipt (`P34`): the top songs as items, the facts as lines, the minutes as the total. */
export interface ReceiptLook {
  readonly head: string
  readonly sub: string
  readonly items: readonly ReceiptLine[]
  readonly lines: readonly ReceiptLine[]
  readonly total: string
  /** One bar per calendar cell, 0 to 1. */
  readonly bars: readonly number[]
  readonly footer: readonly string[]
}

export function receiptLook(input: LookInput): ReceiptLook {
  const { wrapped } = input
  const top = wrapped.topSongs
  const listed = top.reduce((sum, song) => sum + song.plays, 0)
  const rest = wrapped.totals.songsPlayed - top.length
  const items: ReceiptLine[] = top.map(song => ({ name: song.title, value: `x${song.plays}` }))
  if (rest > 0) {
    items.push({
      name: `...and ${rest.toLocaleString()} more`,
      value: `x${Math.max(0, wrapped.totals.plays - listed)}`,
    })
  }
  const traits = wrapped.personality.traits.slice(0, 2).join(' · ').toUpperCase()
  return {
    head: 'SELF.MP3',
    sub: `${periodTitle(wrapped.range)} · ${dateline(input)}`.toUpperCase(),
    items,
    lines: [
      { name: 'PLAYS', value: wrapped.totals.plays.toLocaleString() },
      {
        name: 'DAYS WITH MUSIC',
        value: `${wrapped.totals.activeDays} / ${windowDays(input).count}`,
      },
      { name: 'LONGEST STREAK', value: days(wrapped.longestStreakDays).toUpperCase() },
      { name: 'PEAK HOUR', value: wrapped.peakHour ? clockHour(wrapped.peakHour.hour) : '—' },
    ],
    total: `${figure(wrapped.totals.minutes)} min`,
    bars: calendarGrid(input).cells.flatMap(cell => (cell ? [cell.share] : [])),
    footer: [...(traits ? [traits] : []), 'THANK YOU FOR LISTENING'],
  }
}

/** Wall (`P35`): the period's covers edge to edge, the minutes over them. */
export interface WallLook {
  /** Twelve tiles, three across and four down; the songs repeat when there are fewer. */
  readonly tiles: readonly { readonly songId: number; readonly title: string }[]
  readonly title: string
  readonly figure: string
  readonly line: string
  readonly figures: readonly Figure[]
  readonly foot: string
}

export const WALL_TILES = 12

export function wallLook(input: LookInput): WallLook {
  const { wrapped } = input
  const seen = new Map<number, string>()
  for (const song of [
    ...wrapped.topSongs,
    ...(wrapped.mostInOneDay ? [wrapped.mostInOneDay] : []),
    ...wrapped.discovered,
  ]) {
    if (!seen.has(song.songId)) seen.set(song.songId, song.title)
  }
  const songs = [...seen].map(([songId, title]) => ({ songId, title }))
  const tiles =
    songs.length === 0
      ? []
      : Array.from({ length: WALL_TILES }, (_, i) => songs[i % songs.length] as (typeof songs)[0])
  const when = timeOfDay(wrapped.peakHour?.hour)
  const across = `across ${wrapped.totals.songsPlayed.toLocaleString()} ${wrapped.totals.songsPlayed === 1 ? 'song' : 'songs'}`
  const top = wrapped.topSongs[0]
  return {
    tiles,
    title: periodTitle(wrapped.range),
    figure: figure(wrapped.totals.minutes),
    line: `minutes ${across}${when ? `, mostly ${when}` : ''}`,
    figures: [
      { value: wrapped.totals.plays.toLocaleString(), label: 'plays' },
      { value: String(wrapped.longestStreakDays), label: 'day streak' },
      ...(top ? [{ value: top.title, label: `×${top.plays}` }] : []),
    ],
    foot: `self.mp3 · ${windowDays(input).last.slice(0, 4)}`,
  }
}

/** Calendar (`P36`): the window as a month on a wall, a dot a day. */
export interface CalendarLook {
  readonly title: string
  readonly grid: CalendarGrid
  readonly caption: string
  readonly figure: string
  /** "minutes · 22 days · 9 in a row". */
  readonly figureLine: string
  readonly traits: readonly string[]
}

export function calendarLook(input: LookInput): CalendarLook {
  const { wrapped } = input
  const grid = calendarGrid(input)
  const unit = Math.round(wrapped.totals.minutes) === 1 ? 'minute' : 'minutes'
  const streak = wrapped.longestStreakDays > 1 ? ` · ${wrapped.longestStreakDays} in a row` : ''
  return {
    title: periodTitle(wrapped.range),
    grid,
    caption: calendarCaption(grid),
    figure: figure(wrapped.totals.minutes),
    figureLine: `${unit} · ${days(wrapped.totals.activeDays)}${streak}`,
    traits: wrapped.personality.traits.slice(0, 2),
  }
}

/** One run of the Words look's sentence; `em` is set in the italic, in the accent. */
interface WordsSegment {
  readonly text: string
  readonly em: boolean
}

/** Words (`P37`): the period as one sentence, sized to fill the page. */
export interface WordsLook {
  readonly head: string
  readonly segments: readonly WordsSegment[]
  /** The sentence's size on the 480-wide page: the shorter it is, the larger. */
  readonly size: number
  readonly foot: string
  readonly tags: readonly string[]
  /** The cover tilted in the corner: the number one's. */
  readonly songId: number | null
}

export function wordsSentence(wrapped: Wrapped): readonly WordsSegment[] {
  const plain = (text: string): WordsSegment => ({ text, em: false })
  const em = (text: string): WordsSegment => ({ text, em: true })
  const out: WordsSegment[] = [
    plain('You listened for '),
    em(minutesPhrase(wrapped.totals.minutes)),
  ]
  const when = timeOfDay(wrapped.peakHour?.hour)
  if (when) out.push(plain(`, mostly ${when}`))
  const artist = wrapped.topArtists[0]?.key
  if (artist) out.push(plain(', mostly '), em(artist))
  const record = wrapped.mostInOneDay
  if (record && record.plays > 1) {
    out.push(
      plain(`, and one ${weekdayName(weekdayOf(record.date))} you played `),
      em(record.title),
      plain(` ${timesWord(record.plays)}.`),
    )
  } else {
    out.push(plain('.'))
  }
  return out
}

/** The sentence's size: as large as its length leaves room for on the page. */
export function wordsSize(segments: readonly WordsSegment[]): number {
  const length = segments.reduce((sum, segment) => sum + segment.text.length, 0)
  if (length <= 120) return 50
  if (length <= 150) return 42
  if (length <= 200) return 36
  return 30
}

export function wordsLook(input: LookInput): WordsLook {
  const { wrapped } = input
  const segments = wordsSentence(wrapped)
  const streak = wrapped.longestStreakDays > 1 ? ` · a ${wrapped.longestStreakDays} day streak` : ''
  return {
    head: `self.mp3 · ${periodTitle(wrapped.range)}`,
    segments,
    size: wordsSize(segments),
    foot: `${playsLabel(wrapped.totals.plays)} · ${days(wrapped.totals.activeDays)}${streak}`,
    tags: wrapped.topTags.slice(0, 2).map(tag => tag.key),
    songId: wrapped.topSongs[0]?.songId ?? null,
  }
}

/** Front page (`C16`): the period as a newspaper, for a computer. */
export interface FrontPageLook {
  readonly masthead: string
  readonly strap: readonly string[]
  readonly headline: string
  readonly deck: string
  readonly photo: { readonly songId: number; readonly caption: string } | null
  readonly charts: readonly { readonly title: string; readonly rows: readonly ReceiptLine[] }[]
  readonly grid: CalendarGrid
  /** "The month, day by day"; "…week by week" once the grid has folded. */
  readonly gridTitle: string
  readonly forecast: { readonly title: string; readonly line: string }
}

const GRID_SUBJECT: Record<WrappedRange, string> = {
  week: 'The week',
  month: 'The month',
  quarter: 'Three months',
  year: 'The year',
  all: 'All time',
}

/** A trait's weather: "Night owl, with a chance of repeats". */
const CHANCE_OF: Record<string, string> = {
  'Night owl': 'late nights',
  'Early bird': 'early mornings',
  'Daytime listener': 'daylight',
  'Repeat listener': 'repeats',
  Explorer: 'something new',
  Collector: 'new arrivals',
  'Daily ritual': 'every day',
  Weekender: 'weekends',
  Marathoner: 'long sessions',
  'Casual listener': 'quiet spells',
}

export function forecast(wrapped: Wrapped): { title: string; line: string } {
  const [first, second] = wrapped.personality.traits
  const title = first
    ? second
      ? `${first}, with a chance of ${CHANCE_OF[second] ?? second.toLowerCase()}`
      : first
    : 'Settled, with music'
  const parts = [
    ...(wrapped.peakHour ? [`Peak ${clockHour(wrapped.peakHour.hour)}`] : []),
    ...(wrapped.peakWeekday ? [`busiest on ${weekdayName(wrapped.peakWeekday.weekday)}s`] : []),
  ]
  return { title, line: parts.join(' · ') }
}

export function frontPageLook(input: LookInput): FrontPageLook {
  const { wrapped } = input
  const when = timeOfDayHeadline(wrapped.peakHour?.hour)
  const minutes = minutesPhrase(wrapped.totals.minutes)
  const streak = wrapped.longestStreakDays
  const deck = [
    `${periodTitle(wrapped.range)} came to ${playsLabel(wrapped.totals.plays)} across ${days(wrapped.totals.activeDays)}.`,
    ...(wrapped.peakHour ? [`The busiest hour was ${formatHour(wrapped.peakHour.hour)}.`] : []),
    ...(streak > 1 ? [`The longest run was ${streak} days in a row.`] : []),
  ].join(' ')
  const top = wrapped.topSongs[0]
  const grid = calendarGrid(input)
  return {
    masthead: masthead(wrapped.range),
    strap: ['self.mp3', 'Printed for one reader', dateline(input)],
    headline: `Listener logs ${minutes}${when ? `, most of them ${when}` : ''}`,
    deck,
    photo: top
      ? {
          songId: top.songId,
          caption: `On repeat: ${top.title}, played ${repeatDetail(wrapped) ?? ''}.`,
        }
      : null,
    charts: [
      {
        title: 'The charts',
        rows: wrapped.topSongs.map((song, i) => ({
          name: `${i + 1} · ${song.title}`,
          value: String(song.plays),
        })),
      },
      {
        title: 'By artist',
        rows: wrapped.topArtists
          .slice(0, 3)
          .map(entry => ({ name: entry.key, value: hoursMinutes(entry.minutes) })),
      },
      {
        title: 'By tag',
        rows: wrapped.topTags
          .slice(0, 3)
          .map(entry => ({ name: entry.key, value: hoursMinutes(entry.minutes) })),
      },
    ].filter(chart => chart.rows.length > 0),
    grid,
    gridTitle: `${GRID_SUBJECT[wrapped.range]}, ${grid.unit} by ${grid.unit}`,
    forecast: forecast(wrapped),
  }
}

// --- colour ------------------------------------------------------------------------

/**
 * The inks a look is printed in. A look is an object — a sheet of paper, a
 * receipt, a poster — so it keeps its own colours whichever theme the app is
 * wearing, the way a photo does. Every one comes from `S2`: Paper's ground and
 * inks, the dark ground, and the accent's tag colours for Words' blue page,
 * each at this device's hue.
 */
interface LookInk {
  readonly ground: string
  /** A step off the ground: a chip, a box, a row's quiet bar. */
  readonly tone: string
  readonly ink: string
  readonly second: string
  readonly quiet: string
  readonly accent: string
}

export function lookInk(look: LookId, hue: number): LookInk {
  if (look === 'wall') {
    const dark = darkPalette(hue)
    return {
      ground: dark.surface0,
      tone: dark.surface2,
      ink: dark.textPrimary,
      second: dark.textSecondary,
      quiet: dark.textMuted,
      accent: dark.accent,
    }
  }
  if (look === 'words') {
    const dark = darkPalette(hue)
    const tile = tagColors(hue, 'dark')
    return {
      ground: tile.tile,
      tone: dark.surface3,
      ink: dark.textPrimary,
      second: tile.tileInk,
      quiet: tile.tileInk,
      accent: tile.tileInk,
    }
  }
  const paper = lightPalette(hue)
  return {
    // The receipt is the whiter paper a till prints on.
    ground: look === 'receipt' ? paper.surface1 : paper.surface0,
    tone: paper.surface2,
    ink: paper.textPrimary,
    second: paper.textSecondary,
    quiet: paper.textMuted,
    accent: paper.accent,
  }
}
