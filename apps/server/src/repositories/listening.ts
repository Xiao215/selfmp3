import { artistKey, DAY_MS, splitArtists, UNKNOWN_ARTIST, type TopEntry } from '@selfmp3/shared'

/**
 * The arithmetic the listening pages share: Stats (`stats.ts`) and Wrapped
 * (`wrapped.ts`) count the same plays the same way, so a streak or a number of
 * minutes reads the same on both.
 */

/** Milliseconds as minutes, to one decimal. */
export function toMinutes(ms: number | null): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10
}

/**
 * The start of a listening window, as a UTC timestamp, snapped to a local
 * midnight. Stats and Wrapped both bound their windows with it, so Stats ›
 * Month and the Month report count the same plays.
 *
 * Both pages count in days — active days, the streak, the
 * busiest date, the peak weekday — so a window that started at "now minus
 * seven times twenty-four hours" would straddle eight local dates and report
 * "8 days with music" under a heading that says seven. Snapping to local
 * midnight makes the label and the numbers agree. The bound parameter is the
 * offset, e.g. `-6 days` for a seven-day window (today plus the six before).
 *
 * `localtime` … `utc` is the standard SQLite round trip: shift to wall clock,
 * truncate, step back, shift back to what the column actually stores.
 */
export const WINDOW_START = "datetime('now', 'localtime', 'start of day', ?, 'utc')"

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
 */
export function topArtists(rows: readonly ArtistPlaysRow[], limit: number): TopEntry[] {
  const byKey = new Map<string, { key: string; plays: number; ms: number }>()
  for (const row of rows) {
    const names = splitArtists(row.artist)
    for (const name of names.length > 0 ? names : [UNKNOWN_ARTIST]) {
      const key = artistKey(name)
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
