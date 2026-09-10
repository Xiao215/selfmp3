import {
  listeningPersonality,
  personalityLine,
  WRAPPED_RANGE_DAYS,
  type TopEntry,
  type TopSong,
  type Wrapped,
  type WrappedRange,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * "Wrapped, anytime" — a summary of a listening window.
 *
 * Like `StatsRepository`, everything is a GROUP BY in SQL; only the streak and
 * the personality line are worked out in JavaScript, from a handful of rows.
 * Hours and dates use SQLite's `localtime` so "peak hour" means the owner's
 * evening, not UTC's.
 */

/**
 * The start of the window, as a UTC timestamp, snapped to a local midnight.
 *
 * Everything on this page is counted in days — active days, the streak, the
 * busiest date, the peak weekday — so a window that started at "now minus
 * seven times twenty-four hours" would straddle eight local dates and report
 * "8 days with music" under a heading that says seven. Snapping to local
 * midnight makes the label and the numbers agree. The bound parameter is the
 * offset, e.g. `-6 days` for a seven-day window (today plus the six before).
 *
 * `localtime` … `utc` is the standard SQLite round trip: shift to wall clock,
 * truncate, step back, shift back to what the column actually stores.
 */
const WINDOW_START = "datetime('now', 'localtime', 'start of day', ?, 'utc')"

interface SongPlaysRow {
  song_id: number
  title: string
  artist: string
  has_art: number
  plays: number
  ms: number | null
}

export class WrappedRepository {
  readonly #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  build(range: WrappedRange): Wrapped {
    const days = WRAPPED_RANGE_DAYS[range]
    // `e.` prefixed so the same clause works in every join below.
    const clause = days === null ? '1 = 1' : `e.played_at >= ${WINDOW_START}`
    const params: unknown[] = days === null ? [] : [`-${days - 1} days`]

    const bounds = this.#db
      .prepare<unknown[], { from_at: string | null; to_at: string }>(
        `SELECT ${days === null ? 'NULL' : WINDOW_START} AS from_at, datetime('now') AS to_at`,
      )
      .get(...params)

    const totals = this.#db
      .prepare<unknown[], { plays: number; ms: number | null; songs: number; days: number }>(
        `SELECT COUNT(*) AS plays,
                COALESCE(SUM(e.ms_played), 0) AS ms,
                COUNT(DISTINCT e.song_id) AS songs,
                COUNT(DISTINCT date(e.played_at, 'localtime')) AS days
           FROM play_events e WHERE ${clause}`,
      )
      .get(...params)

    const topSongs = this.#db
      .prepare<unknown[], SongPlaysRow>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY s.id ORDER BY plays DESC, s.title LIMIT 5`,
      )
      .all(...params)
      .map(toTopSong)

    const topArtists: TopEntry[] = this.#db
      .prepare<unknown[], { key: string; plays: number; ms: number | null }>(
        `SELECT COALESCE(NULLIF(s.artist, ''), 'Unknown artist') AS key,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY key ORDER BY plays DESC, key LIMIT 5`,
      )
      .all(...params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const topTags: TopEntry[] = this.#db
      .prepare<unknown[], { key: string; plays: number; ms: number | null }>(
        `SELECT t.name AS key, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e
           JOIN song_tags st ON st.song_id = e.song_id
           JOIN tags t ON t.id = st.tag_id
          WHERE ${clause}
          GROUP BY t.id ORDER BY plays DESC, key LIMIT 5`,
      )
      .all(...params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const hourly = Array.from({ length: 24 }, () => 0)
    for (const row of this.#db
      .prepare<unknown[], { hour: string; plays: number }>(
        `SELECT strftime('%H', e.played_at, 'localtime') AS hour, COUNT(*) AS plays
           FROM play_events e WHERE ${clause} GROUP BY hour`,
      )
      .all(...params)) {
      hourly[Number(row.hour)] = row.plays
    }

    const weekday = Array.from({ length: 7 }, () => 0)
    for (const row of this.#db
      .prepare<unknown[], { day: string; plays: number }>(
        `SELECT strftime('%w', e.played_at, 'localtime') AS day, COUNT(*) AS plays
           FROM play_events e WHERE ${clause} GROUP BY day`,
      )
      .all(...params)) {
      weekday[Number(row.day)] = row.plays
    }

    const busiest = this.#db
      .prepare<unknown[], { date: string; plays: number }>(
        `SELECT date(e.played_at, 'localtime') AS date, COUNT(*) AS plays
           FROM play_events e WHERE ${clause}
          GROUP BY date ORDER BY plays DESC, date DESC LIMIT 1`,
      )
      .get(...params)

    const record = this.#db
      .prepare<unknown[], SongPlaysRow & { date: string }>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                date(e.played_at, 'localtime') AS date, COUNT(*) AS plays, 0 AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY s.id, date ORDER BY plays DESC, date DESC, s.title LIMIT 1`,
      )
      .get(...params)

    // "Discovered": added inside the window, and played enough to mean it.
    // For all time that is every song with three plays, which is honest too.
    const discovered = this.#db
      .prepare<unknown[], SongPlaysRow>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
            AND ${days === null ? '1 = 1' : `s.added_at >= ${WINDOW_START}`}
          GROUP BY s.id HAVING COUNT(*) >= 3
          ORDER BY plays DESC, s.title LIMIT 10`,
      )
      .all(...params, ...params)
      .map(toTopSong)

    const dates = this.#db
      .prepare<unknown[], { date: string }>(
        `SELECT DISTINCT date(e.played_at, 'localtime') AS date
           FROM play_events e WHERE ${clause} ORDER BY date`,
      )
      .all(...params)
      .map(row => row.date)
    const longestStreakDays = longestRun(dates)

    const plays = totals?.plays ?? 0
    const minutes = toMinutes(totals?.ms ?? 0)
    const traits = listeningPersonality({
      plays,
      songsPlayed: totals?.songs ?? 0,
      hourly,
      weekday,
      topFivePlays: topSongs.reduce((sum, song) => sum + song.plays, 0),
      discovered: discovered.length,
      longestStreakDays,
      minutes,
      activeDays: totals?.days ?? 0,
    })

    return {
      range,
      from: bounds?.from_at ? toIso(bounds.from_at) : null,
      to: toIso(bounds?.to_at ?? new Date().toISOString()),
      totals: {
        plays,
        minutes,
        songsPlayed: totals?.songs ?? 0,
        activeDays: totals?.days ?? 0,
      },
      topSongs,
      topArtists,
      topTags,
      peakHour: peak(hourly, 'hour'),
      peakWeekday: peak(weekday, 'weekday'),
      busiestDate: busiest ? { date: busiest.date, plays: busiest.plays } : null,
      longestStreakDays,
      mostInOneDay: record
        ? {
            songId: record.song_id,
            title: record.title,
            artist: record.artist,
            hasArt: record.has_art === 1,
            date: record.date,
            plays: record.plays,
          }
        : null,
      discovered,
      personality: { traits, line: personalityLine(traits) },
    }
  }
}

function toTopSong(row: SongPlaysRow): TopSong {
  return {
    songId: row.song_id,
    title: row.title,
    artist: row.artist,
    hasArt: row.has_art === 1,
    plays: row.plays,
    minutes: toMinutes(row.ms),
  }
}

function toMinutes(ms: number | null): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10
}

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) as an ISO string. */
function toIso(sqlite: string): string {
  const parsed = Date.parse(sqlite.includes('T') ? sqlite : `${sqlite.replace(' ', 'T')}Z`)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : sqlite
}

/** The best slot, or null when every slot is empty. Ties go to the earlier one. */
function peak<K extends string>(
  counts: readonly number[],
  key: K,
): ({ [P in K]: number } & { plays: number }) | null {
  let best = -1
  let bestPlays = 0
  counts.forEach((plays, index) => {
    if (plays > bestPlays) {
      bestPlays = plays
      best = index
    }
  })
  if (best < 0) return null
  return { [key]: best, plays: bestPlays } as { [P in K]: number } & { plays: number }
}

/** Longest run of consecutive dates in a sorted, distinct list of YYYY-MM-DD. */
export function longestRun(dates: readonly string[]): number {
  if (dates.length === 0) return 0
  let longest = 1
  let run = 1
  for (let i = 1; i < dates.length; i++) {
    const previous = dates[i - 1]
    const current = dates[i]
    if (previous === undefined || current === undefined) continue
    run = dayGap(previous, current) === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  return longest
}

function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.round((b - a) / 86_400_000)
}
