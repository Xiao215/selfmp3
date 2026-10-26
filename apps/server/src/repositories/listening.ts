import {
  artistKey,
  DAY_MS,
  fromSqliteTime,
  splitArtists,
  toSqliteTime,
  UNKNOWN_ARTIST,
  type TopEntry,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * The arithmetic the listening pages share: Stats (`stats.ts`) and Wrapped
 * (`wrapped.ts`) count the same plays the same way, so a streak or a number of
 * minutes reads the same on both.
 */

/** Milliseconds as minutes, to one decimal. */
export function toMinutes(ms: number | null): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10
}

/** This server's own time zone: the reader's when the app does not say theirs. */
const SERVER_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * The time zone Stats and Wrapped count days and hours in: the reader's, as
 * the app sends it (an IANA name, `Asia/Shanghai`), so "today", the peak hour
 * and "Early bird" are the reader's own however far they are from the
 * server. SQLite's `localtime` was the server's zone, so a listener abroad
 * saw their evening as a Los Angeles morning. No zone, or one this server
 * does not know, is the server's own.
 */
export function readerZone(name?: string): string {
  if (!name) return SERVER_ZONE
  try {
    wallFormat(name)
    return name
  } catch {
    return SERVER_ZONE
  }
}

const formats = new Map<string, Intl.DateTimeFormat>()

function wallFormat(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone)
  if (!format) {
    // Throws for a zone Intl does not know, before anything is kept.
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formats.set(zone, format)
  }
  return format
}

/** How far `zone`'s clocks are ahead of UTC at `ms`, in milliseconds. */
function zoneOffset(ms: number, zone: string): number {
  const parts = wallFormat(zone).formatToParts(new Date(ms))
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(p => p.type === type)?.value)
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
  return wall - Math.floor(ms / 1000) * 1000
}

/** Each UTC day's offset in a zone, or null for a day its clocks change on. */
const dayOffsets = new Map<string, number | null>()

/**
 * A stored UTC time (`2026-10-26 03:15:00`) as `zone`'s wall clock, in the
 * same format: what the `wall_clock` SQL function answers. Most days keep one
 * offset all day, so it is worked out once a day; only the two days a year
 * the clocks change are worked out play by play.
 */
export function wallClock(utc: string, zone: string): string {
  const ms = fromSqliteTime(utc)
  if (!Number.isFinite(ms)) return utc
  const day = Math.floor(ms / DAY_MS)
  const key = `${zone} ${day}`
  let offset = dayOffsets.get(key)
  if (offset === undefined) {
    const start = zoneOffset(day * DAY_MS, zone)
    offset = start === zoneOffset((day + 1) * DAY_MS, zone) ? start : null
    dayOffsets.set(key, offset)
  }
  return toSqliteTime(ms + (offset ?? zoneOffset(ms, zone)))
}

/** The day `ms` falls on in `zone`, as `2026-10-26`. */
export function zoneDayKey(ms: number, zone: string): string {
  return toSqliteTime(ms + zoneOffset(ms, zone)).slice(0, 10)
}

/** The day `back` days before a `YYYY-MM-DD`, in the same form. */
export function dayKeyBefore(key: string, back: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10)
}

const zoned = new WeakSet<Db>()

/**
 * Teach a database `wall_clock(played_at, zone)`, the listening queries'
 * `date(…, 'localtime')` for a zone that need not be the server's.
 */
export function useZones(db: Db): void {
  if (zoned.has(db)) return
  db.function('wall_clock', { deterministic: true }, (utc: unknown, zone: unknown) =>
    typeof utc === 'string' && typeof zone === 'string' ? wallClock(utc, zone) : null,
  )
  zoned.add(db)
}

/**
 * The start of a listening window, as a stored UTC time, snapped to a
 * midnight in `zone`: today and the `days - 1` days before it. Stats and
 * Wrapped both bound their windows with it, so Stats › Month and the Month
 * report count the same plays.
 *
 * Both pages count in days — active days, the streak, the
 * busiest date, the peak weekday — so a window that started at "now minus
 * seven times twenty-four hours" would straddle eight local dates and report
 * "8 days with music" under a heading that says seven. Snapping to local
 * midnight makes the label and the numbers agree.
 */
export function windowStart(days: number, zone: string, now = Date.now()): string {
  const midnight = Date.parse(`${dayKeyBefore(zoneDayKey(now, zone), days - 1)}T00:00:00Z`)
  // The instant that midnight's wall clock reads: stepped back by the offset
  // there, which a clock change between now and then can move.
  const guess = midnight - zoneOffset(midnight, zone)
  return toSqliteTime(midnight - zoneOffset(guess, zone))
}

/** Plays of one artist string, as SQL groups them. */
export interface ArtistPlaysRow {
  artist: string
  plays: number
  ms: number | null
}

/**
 * The artists played most, from plays grouped by the artist string as
 * written. Not ranked in SQL: "ヨルシカ feat. suis" counts for ヨルシカ and for
 * suis, as everywhere else in the app (`splitArtists`), and two spellings
 * that compare equal are one artist, under the spelling played most. A song
 * with no artist counts for `UNKNOWN_ARTIST`. Rows come most played first.
 *
 * Artists joined by their other names (shared artistJoins.ts) are one entry,
 * under the name they are shown by, their plays summed: `shownAs` maps each
 * joined artist's key to it. A song credited to both counts once.
 */
export function topArtists(
  rows: readonly ArtistPlaysRow[],
  limit: number,
  shownAs: ReadonlyMap<string, string> = new Map(),
): TopEntry[] {
  const byKey = new Map<string, { key: string; plays: number; ms: number }>()
  for (const row of rows) {
    const names = splitArtists(row.artist)
    const counted = new Set<string>()
    for (const written of names.length > 0 ? names : [UNKNOWN_ARTIST]) {
      const name = shownAs.get(artistKey(written)) ?? written
      const key = artistKey(name)
      if (counted.has(key)) continue
      counted.add(key)
      const had = byKey.get(key)
      if (had) {
        had.plays += row.plays
        had.ms += row.ms ?? 0
      } else byKey.set(key, { key: name, plays: row.plays, ms: row.ms ?? 0 })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.plays - a.plays || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(entry => ({ key: entry.key, plays: entry.plays, minutes: toMinutes(entry.ms) }))
}

/** Whole days between two YYYY-MM-DD strings, ignoring time zones and DST. */
export function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.round((b - a) / DAY_MS)
}

/**
 * Runs of consecutive dates in a sorted, distinct list of YYYY-MM-DD: the
 * longest, and the one the list ends on.
 */
export function runs(dates: readonly string[]): { longest: number; last: number } {
  if (dates.length === 0) return { longest: 0, last: 0 }
  let longest = 1
  let run = 1
  for (let i = 1; i < dates.length; i++) {
    run = dayGap(dates[i - 1]!, dates[i]!) === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  return { longest, last: run }
}
