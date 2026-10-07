import { DAY_MS } from './math.js'
import { fromSqliteTime } from './sync.js'

/**
 * Calendar days as a person counts them, where the reader is: the pieces the
 * app's "3 weeks ago" and "Tuesday" lines are built from (the song page's
 * `timeAgo`, Playlists' `relativeDay`), the song page's busiest day, and
 * Wrapped's weekday names.
 */

/** The days of the week by `Date.getDay()`: Sunday first. */
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Local midnight of the day `date` falls on, in milliseconds. */
export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * How many calendar days ago a stamp was, where the reader is: a song played
 * at 23:00 was one day ago at 08:00 the next morning, nine hours later. The
 * server writes UTC without a zone (`2026-09-13 06:17:55`), read as UTC; a
 * bucket's ISO carries its own. Rounded, because a day that crosses a clock
 * change is 23 or 25 hours long. Negative for a stamp from the future, and
 * null for one that cannot be read.
 */
export function calendarDaysAgo(
  value: string,
  now: Date,
): { readonly days: number; readonly then: Date } | null {
  const then = new Date(fromSqliteTime(value))
  if (Number.isNaN(then.getTime())) return null
  return { days: Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY_MS), then }
}
