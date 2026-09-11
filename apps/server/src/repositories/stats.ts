import type { DailyPlays, HourlyPlays, Stats, StatsRange, TopEntry, TopSong } from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * Listening statistics, derived from the `play_events` table.
 *
 * Everything is computed in SQL rather than by pulling rows into JavaScript —
 * SQLite is very good at this, and it keeps the whole stats page to a handful
 * of queries no matter how long the history gets.
 */

const RANGE_DAYS: Record<StatsRange, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '365d': 365,
  all: null,
}

/**
 * A client's ISO 8601 timestamp as SQLite's UTC `YYYY-MM-DD HH:MM:SS`, the
 * format `datetime('now')` writes and every range query compares against.
 *
 * Null means "use now": for no timestamp, an unreadable one, and one in the
 * future. A phone whose clock runs ahead must not put a play in the future,
 * where it would top every "recently played" list until the future arrived.
 */
export function sqliteTime(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms) || ms > now) return null
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export class StatsRepository {
  readonly #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /**
   * Store one play.
   *
   * `playedAt` is SQLite's own UTC `YYYY-MM-DD HH:MM:SS` (see `sqliteTime`),
   * or null for now. Returns false when `clientId` was already recorded — a
   * resend of a play the server has — so the caller does not count it twice.
   */
  record(
    songId: number,
    msPlayed: number,
    completed: boolean,
    playedAt: string | null = null,
    clientId: string | null = null,
  ): boolean {
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO play_events (song_id, ms_played, completed, played_at, client_id)
         VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?)`,
      )
      .run(songId, msPlayed, completed ? 1 : 0, playedAt, clientId)
    return result.changes > 0
  }

  /** SQL fragment plus params limiting events to the requested window. */
  #window(range: StatsRange): { clause: string; params: unknown[] } {
    const days = RANGE_DAYS[range]
    if (days === null) return { clause: '1 = 1', params: [] }
    return { clause: "played_at >= datetime('now', ?)", params: [`-${days} days`] }
  }

  build(range: StatsRange): Stats {
    const { clause, params } = this.#window(range)

    const totals = this.#db
      .prepare<unknown[], { plays: number; ms: number | null; songs: number }>(
        `SELECT COUNT(*) AS plays,
                COALESCE(SUM(ms_played), 0) AS ms,
                COUNT(DISTINCT song_id) AS songs
           FROM play_events WHERE ${clause}`,
      )
      .get(...params)

    const library = this.#db
      .prepare<[], { count: number; duration: number | null; never: number }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(duration), 0) AS duration,
                COALESCE(SUM(CASE WHEN play_count = 0 THEN 1 ELSE 0 END), 0) AS never
           FROM songs WHERE missing = 0`,
      )
      .get()

    const daily: DailyPlays[] = this.#db
      .prepare<unknown[], { date: string; plays: number; ms: number | null }>(
        `SELECT date(played_at) AS date, COUNT(*) AS plays, COALESCE(SUM(ms_played), 0) AS ms
           FROM play_events WHERE ${clause}
          GROUP BY date(played_at) ORDER BY date`,
      )
      .all(...params)
      .map(row => ({
        date: row.date,
        plays: row.plays,
        minutes: Math.round(((row.ms ?? 0) / 60_000) * 10) / 10,
      }))

    // Zero-fill so the chart shows quiet days as gaps rather than skipping them.
    const filledDaily = RANGE_DAYS[range] === null ? daily : zeroFill(daily, RANGE_DAYS[range] ?? 30)

    const hourlyRows = this.#db
      .prepare<unknown[], { hour: string; plays: number }>(
        `SELECT strftime('%H', played_at, 'localtime') AS hour, COUNT(*) AS plays
           FROM play_events WHERE ${clause}
          GROUP BY hour ORDER BY hour`,
      )
      .all(...params)

    const hourly: HourlyPlays[] = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0 }))
    for (const row of hourlyRows) {
      const hour = Number(row.hour)
      const slot = hourly[hour]
      if (slot) hourly[hour] = { hour, plays: row.plays }
    }

    const topArtists: TopEntry[] = this.#db
      .prepare<unknown[], { key: string; plays: number; ms: number | null }>(
        `SELECT COALESCE(NULLIF(s.artist, ''), 'Unknown artist') AS key,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause.replace(/played_at/g, 'e.played_at')}
          GROUP BY key ORDER BY plays DESC, key LIMIT 10`,
      )
      .all(...params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const topTags: TopEntry[] = this.#db
      .prepare<unknown[], { key: string; plays: number; ms: number | null }>(
        `SELECT t.name AS key, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e
           JOIN song_tags st ON st.song_id = e.song_id
           JOIN tags t ON t.id = st.tag_id
          WHERE ${clause.replace(/played_at/g, 'e.played_at')}
          GROUP BY t.id ORDER BY plays DESC, key LIMIT 10`,
      )
      .all(...params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const topSongs: TopSong[] = this.#db
      .prepare<
        unknown[],
        { song_id: number; title: string; artist: string; has_art: number; plays: number; ms: number | null }
      >(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause.replace(/played_at/g, 'e.played_at')}
          GROUP BY s.id ORDER BY plays DESC, s.title LIMIT 20`,
      )
      .all(...params)
      .map(row => ({
        songId: row.song_id,
        title: row.title,
        artist: row.artist,
        hasArt: row.has_art === 1,
        plays: row.plays,
        minutes: toMinutes(row.ms),
      }))

    const streaks = this.#streaks()

    return {
      range,
      totals: {
        plays: totals?.plays ?? 0,
        minutes: toMinutes(totals?.ms ?? 0),
        songsPlayed: totals?.songs ?? 0,
        librarySize: library?.count ?? 0,
        libraryMinutes: toMinutes((library?.duration ?? 0) * 1000),
        neverPlayed: library?.never ?? 0,
      },
      streakDays: streaks.current,
      longestStreakDays: streaks.longest,
      daily: filledDaily,
      hourly,
      topArtists,
      topTags,
      topSongs,
    }
  }

  /**
   * Current and longest run of consecutive days with at least one play.
   *
   * Computed over distinct local dates. Today not yet having a play does not
   * break the current streak — you might still put something on this evening.
   */
  #streaks(): { current: number; longest: number } {
    const dates = this.#db
      .prepare<[], { date: string }>(
        "SELECT DISTINCT date(played_at, 'localtime') AS date FROM play_events ORDER BY date",
      )
      .all()
      .map(row => row.date)

    if (dates.length === 0) return { current: 0, longest: 0 }

    let longest = 1
    let run = 1
    for (let i = 1; i < dates.length; i++) {
      const previous = dates[i - 1]
      const current = dates[i]
      if (previous === undefined || current === undefined) continue
      run = dayGap(previous, current) === 1 ? run + 1 : 1
      if (run > longest) longest = run
    }

    const today = localDate(new Date())
    const last = dates[dates.length - 1]
    if (last === undefined) return { current: 0, longest }
    const gapFromToday = dayGap(last, today)
    const current = gapFromToday <= 1 ? run : 0

    return { current, longest }
  }

  /** Recent plays, newest first. Powers the history list. */
  recent(limit = 100): Array<{ songId: number; playedAt: string; completed: boolean }> {
    return this.#db
      .prepare<[number], { song_id: number; played_at: string; completed: number }>(
        'SELECT song_id, played_at, completed FROM play_events ORDER BY played_at DESC, id DESC LIMIT ?',
      )
      .all(limit)
      .map(row => ({
        songId: row.song_id,
        playedAt: row.played_at,
        completed: row.completed === 1,
      }))
  }
}

function toMinutes(ms: number | null): number {
  return Math.round(((ms ?? 0) / 60_000) * 10) / 10
}

function localDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Whole days between two YYYY-MM-DD strings, ignoring time zones and DST. */
function dayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY
  return Math.round((b - a) / 86_400_000)
}

/** Insert zero rows for days with no plays, so charts show a continuous axis. */
function zeroFill(rows: readonly DailyPlays[], days: number): DailyPlays[] {
  const byDate = new Map(rows.map(row => [row.date, row]))
  const out: DailyPlays[] = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today)
    day.setDate(day.getDate() - offset)
    const key = localDate(day)
    out.push(byDate.get(key) ?? { date: key, plays: 0, minutes: 0 })
  }
  return out
}
