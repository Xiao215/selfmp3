import {
  formatLongDuration,
  WRAPPED_RANGE_LABELS,
  type Wrapped,
  type WrappedRange,
} from '@selfmp3/shared'
import { formatHour, playsLabel } from '../stats/stats.model'

/**
 * Wrapped, for any window, without the screen: the web's `WrappedView` rules.
 *
 * Everything comes from the same play events Stats uses, so the two pages
 * agree. The useful version of a yearly summary is being able to ask what last
 * week sounded like on a Tuesday.
 */

export const WRAPPED_RANGES: readonly WrappedRange[] = ['week', 'month', 'quarter', 'year', 'all']

export const RANGE_SHORT: Record<WrappedRange, string> = {
  week: 'Week',
  month: 'Month',
  quarter: '3 months',
  year: 'Year',
  all: 'All time',
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function weekdayName(weekday: number): string {
  return WEEKDAYS[weekday] ?? '—'
}

/** "Last 30 days · you listened for". */
export function eyebrow(range: WrappedRange): string {
  return `${WRAPPED_RANGE_LABELS[range]} · you listened for`
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
    { label: 'Longest streak', value: `${streak} ${streak === 1 ? 'day' : 'days'}` },
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

/** "On repeat" is a chapter only when there is a record, so Discovered's number moves. */
export function discoveredChapter(wrapped: Pick<Wrapped, 'mostInOneDay'>): string {
  return wrapped.mostInOneDay ? '04' : '03'
}

/**
 * Discovered is worth a chapter only when it says something Top songs has not.
 * In a window where everything played was new — a first week, a fresh library —
 * the two lists were the same songs in the same order, one under the other.
 */
export function showDiscovered(wrapped: Pick<Wrapped, 'topSongs' | 'discovered'>): boolean {
  const discovered = wrapped.discovered.slice(0, DISCOVERED_SHOWN).map(song => song.songId)
  const top = wrapped.topSongs.map(song => song.songId)
  const same = discovered.length === top.length && discovered.every((id, i) => id === top[i])
  return !(same && discovered.length > 0)
}

/** How many discoveries the chapter lists. */
export const DISCOVERED_SHOWN = 8

/** Each ranked row's share of the first, as a quiet bar behind its name. */
export function rankShare(plays: number, max: number): number {
  return Math.max(6, (plays / Math.max(max, 1)) * 100)
}

/** "46 plays · 83 minutes" ("1 play · 1 minute"). */
export function numberOneLine(song: { plays: number; minutes: number }): string {
  const minutes = Math.round(song.minutes)
  return `${playsLabel(song.plays)} · ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

export function repeatNote(wrapped: Pick<Wrapped, 'busiestDate'>): string {
  const busiest = wrapped.busiestDate
    ? ` · busiest day overall: ${playsLabel(wrapped.busiestDate.plays)}`
    : ''
  return `The most you played one song in a single day${busiest}.`
}

/** A filename that sorts sensibly and says what it is. */
export function shareFileName(wrapped: Pick<Wrapped, 'range' | 'to'>): string {
  return `selfmp3-wrapped-${wrapped.range}-${wrapped.to.slice(0, 10)}.png`
}
