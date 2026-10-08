import { WEEKDAYS, WRAPPED_RANGE_LABELS, type Wrapped, type WrappedRange } from '@selfmp3/shared'
import { periodLabel, STATS_PERIODS } from '../stats/stats.model'

/**
 * Wrapped, for any window, without the screen.
 *
 * Everything comes from the same play events Stats uses, so the two pages
 * agree. The useful version of a yearly summary is being able to ask what last
 * week sounded like on a Tuesday.
 */

/*
 * The windows, their names on the period control and Stats' name for each
 * are Stats' own (`STATS_PERIODS`, `periodLabel`, `statsRangeFor`): the two
 * pages offer the same five.
 */

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '—'
}

export function figure(minutes: number): string {
  return Math.round(minutes).toLocaleString()
}

/** An empty window is almost always the wrong one: the longer ones are offered. */
export function longerRanges(range: WrappedRange): readonly WrappedRange[] {
  return STATS_PERIODS.slice(STATS_PERIODS.indexOf(range) + 1)
}

export function emptyTitle(range: WrappedRange): string {
  return `Nothing in ${range === 'all' ? 'your history' : 'this window'} yet`
}

export function emptyHint(range: WrappedRange): string {
  return range === 'all'
    ? 'Play something and the report starts keeping score — the first minute counts.'
    : `You have no plays in the ${WRAPPED_RANGE_LABELS[range].toLowerCase()}. Try a longer window, or go and put something on.`
}

export function tryLabel(range: WrappedRange): string {
  return `Try ${periodLabel(range).toLowerCase()}`
}

/** A filename that sorts sensibly and says what it is. */
export function shareFileName(wrapped: Pick<Wrapped, 'range' | 'to'>): string {
  return `selfmp3-report-${wrapped.range}-${wrapped.to.slice(0, 10)}.png`
}
