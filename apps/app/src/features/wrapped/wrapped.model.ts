import {
  plural,
  formatLongDuration,
  WRAPPED_RANGE_LABELS,
  type Wrapped,
  type WrappedRange,
} from '@selfmp3/shared'
import { formatHour, playsLabel } from '../stats/stats.model'

/**
 * Wrapped, for any window, without the screen.
 *
 * Everything comes from the same play events Stats uses, so the two pages
 * agree. The useful version of a yearly summary is being able to ask what last
 * week sounded like on a Tuesday.
 */

export const WRAPPED_RANGES: readonly WrappedRange[] = ['week', 'month', 'quarter', 'year', 'all']

const RANGE_SHORT: Record<WrappedRange, string> = {
  week: 'Week',
  month: 'Month',
  quarter: '3 months',
  year: 'Year',
  all: 'All time',
}

/** A window's name on the period control: "Week", "3 months". */
export function rangeShort(range: WrappedRange): string {
  return RANGE_SHORT[range]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '—'
}

export function figure(minutes: number): string {
  return Math.round(minutes).toLocaleString()
}

/** "minutes", and the hours too once there are hours to show. */
export function figureUnit(minutes: number): string {
  return minutes >= 60 ? `minutes · ${formatLongDuration(minutes * 60)}` : 'minutes'
}

export interface Fact {
  readonly label: string
  readonly value: string
  readonly hint?: string
}

export function facts(wrapped: Wrapped): readonly Fact[] {
  const streak = wrapped.longestStreakDays
  return [
    { label: 'Plays', value: wrapped.totals.plays.toLocaleString() },
    { label: 'Songs', value: wrapped.totals.songsPlayed.toLocaleString() },
    { label: 'Days with music', value: wrapped.totals.activeDays.toLocaleString() },
    { label: 'Longest streak', value: `${plural(streak, 'day', 'days')}` },
    {
      label: 'Peak hour',
      value: wrapped.peakHour ? formatHour(wrapped.peakHour.hour) : '—',
      hint: wrapped.peakHour ? playsLabel(wrapped.peakHour.plays) : undefined,
    },
    {
      label: 'Best day',
      value: wrapped.peakWeekday ? weekdayName(wrapped.peakWeekday.weekday) : '—',
      hint: wrapped.peakWeekday ? playsLabel(wrapped.peakWeekday.plays) : undefined,
    },
  ]
}

/** An empty window is almost always the wrong one: the longer ones are offered. */
export function longerRanges(range: WrappedRange): readonly WrappedRange[] {
  return WRAPPED_RANGES.slice(WRAPPED_RANGES.indexOf(range) + 1)
}

export function emptyTitle(range: WrappedRange): string {
  return `Nothing in ${range === 'all' ? 'your history' : 'this window'} yet`
}

export function emptyHint(range: WrappedRange): string {
  return range === 'all'
    ? 'Play something and Wrapped starts keeping score — the first minute counts.'
    : `You have no plays in the ${WRAPPED_RANGE_LABELS[range].toLowerCase()}. Try a longer window, or go and put something on.`
}

export function tryLabel(range: WrappedRange): string {
  return `Try ${RANGE_SHORT[range].toLowerCase()}`
}

/** A filename that sorts sensibly and says what it is. */
export function shareFileName(wrapped: Pick<Wrapped, 'range' | 'to'>): string {
  return `selfmp3-wrapped-${wrapped.range}-${wrapped.to.slice(0, 10)}.png`
}
