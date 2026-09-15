import type { DailyPlays, HourlyPlays, StatsRange, WrappedRange } from '@selfmp3/shared'

/**
 * Listening stats, without the screen: the web's `StatsView` rules.
 *
 * Everything on the page is derived from stored play events, so the questions
 * can change later without the data having been thrown away. The page leads
 * with tiles rather than charts, because most of these answers are one number.
 */

/** The page's two halves: the numbers, and the story told with them. */
export type StatsTab = 'overview' | 'report'

export const STATS_TABS: readonly { value: StatsTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'report', label: 'Report' },
]

/**
 * The one window both tabs share. Overview and Report were two pages with two
 * range controls that named the same windows differently ("1m" and "Month")
 * and forgot the choice on the way between them.
 */
export type StatsPeriod = 'week' | 'month' | 'quarter' | 'year' | 'all'

export const STATS_PERIODS: readonly StatsPeriod[] = ['week', 'month', 'quarter', 'year', 'all']

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  week: 'Week',
  month: 'Month',
  quarter: '3 months',
  year: 'Year',
  all: 'All time',
}

/** Five choices fit a phone's width only in short. */
const PERIOD_SHORT: Record<StatsPeriod, string> = {
  week: 'Wk',
  month: 'Mo',
  quarter: '3 mo',
  year: 'Yr',
  all: 'All',
}

/** "3 months" with room for it; "3 mo" on a phone. */
export function periodLabel(period: StatsPeriod, wide: boolean): string {
  return (wide ? PERIOD_LABELS : PERIOD_SHORT)[period]
}

const STATS_RANGE_OF: Record<StatsPeriod, StatsRange> = {
  week: '7d',
  month: '30d',
  quarter: '90d',
  year: '365d',
  all: 'all',
}

/** The window as the stats endpoint names it. */
export function statsRangeFor(period: StatsPeriod): StatsRange {
  return STATS_RANGE_OF[period]
}

/** The window as the report endpoint names it: the same words, as it happens. */
export function wrappedRangeFor(period: StatsPeriod): WrappedRange {
  return period
}

/** And back, for the report's "Try a longer window" buttons. */
export function periodOfWrapped(range: WrappedRange): StatsPeriod {
  return range
}

export interface ColumnDatum {
  readonly label: string
  readonly value: number
  /** The longer label a tooltip reads out. */
  readonly detail?: string
}

function localDate(iso: string): Date | null {
  const date = new Date(`${iso}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "12 Sep", in the reader's own order. */
export function shortDate(iso: string): string {
  return localDate(iso)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) ?? iso
}

/** "Sat, 12 September". */
export function longDate(iso: string): string {
  return (
    localDate(iso)?.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }) ?? iso
  )
}

/** 0 → "12am", 13 → "1pm". */
export function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

export function dailyColumns(daily: readonly DailyPlays[]): ColumnDatum[] {
  return daily.map(day => ({
    label: shortDate(day.date),
    value: day.plays,
    detail: longDate(day.date),
  }))
}

/** Labelled every six hours; each column's tooltip names its hour. */
export function hourlyColumns(hourly: readonly HourlyPlays[]): ColumnDatum[] {
  return hourly.map(hour => ({
    label: hour.hour % 6 === 0 ? formatHour(hour.hour) : '',
    value: hour.plays,
    detail: `${formatHour(hour.hour)}–${formatHour((hour.hour + 1) % 24)}`,
  }))
}

/** The busiest hour, or nothing when no hour has a play. */
export function peakHour(hourly: readonly HourlyPlays[]): HourlyPlays | null {
  if (hourly.length === 0) return null
  const best = hourly.reduce((a, b) => (b.plays > a.plays ? b : a))
  return best.plays > 0 ? best : null
}

/** Every song once, at its latest play: one song on repeat should not fill the list. */
export function recentSongs<T extends { readonly songId: number }>(events: readonly T[]): T[] {
  const seen = new Set<number>()
  return events.filter(event => {
    if (seen.has(event.songId)) return false
    seen.add(event.songId)
    return true
  })
}

/** Show an axis label every so many columns, so about seven fit. */
export function labelEvery(count: number): number {
  return Math.max(1, Math.ceil(count / 7))
}

/** Round an axis maximum up to something a person would choose. */
export function niceCeiling(value: number): number {
  if (value <= 5) return 5
  if (value <= 10) return 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const rounded = normalized <= 1.5 ? 1.5 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return rounded * magnitude
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toFixed(1)
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

export function daysLabel(days: number): string {
  return plural(days, 'day', 'days')
}

export function playsLabel(plays: number): string {
  return plural(plays, 'play', 'plays')
}

/** "best: 4 days", once there has been a streak at all. */
export function bestStreakHint(longest: number): string | undefined {
  return longest > 0 ? `best: ${longest} days` : undefined
}

/** A bar's share of the longest, never so thin it disappears. */
export function barShare(value: number, max: number, floor = 2): number {
  return Math.max(floor, (value / Math.max(max, 1)) * 100)
}
