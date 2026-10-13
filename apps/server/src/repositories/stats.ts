import {
  localDayKey,
  toSqliteTime,
  type DailyPlays,
  type HourlyPlays,
  type Stats,
  type StatsRange,
  type TopEntry,
  type TopSong,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import { dayGap, runs, toMinutes, topArtists, type ArtistPlaysRow } from './listening.js'

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
  return toSqliteTime(ms)
}

export class StatsRepository {
  readonly #db: Db
  readonly #record
  readonly #playDates
  readonly #latestPlay

  constructor(db: Db) {
    this.#db = db
    this.#record = db.prepare(
      `INSERT OR IGNORE INTO play_events (song_id, ms_played, completed, played_at, client_id)
       VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?)`,
    )
    this.#playDates = db.prepare<[], { date: string }>(
      "SELECT DISTINCT date(played_at, 'localtime') AS date FROM play_events ORDER BY date",
    )
    this.#latestPlay = db.prepare<[], { id: number | null }>(
      'SELECT MAX(id) AS id FROM play_events',
    )
  }

  /**
   * The id of the newest play recorded here, or 0 before any. Every play moves
   * it — one from this server's own route and one replayed from another device
   * alike, since both go through `record` — while the library version does not
   * move for a play at all. So the two together say whether anything a song
   * answer carries, its play count and last play included, can have changed.
   * It is the table's rowid, so the answer is one step down its index.
   */
  latestPlayId(): number {
    return this.#latestPlay.get()?.id ?? 0
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
    return this.#record.run(songId, msPlayed, completed ? 1 : 0, playedAt, clientId).changes > 0
  }

  /**
   * Each month that has plays (UTC `YYYY-MM`), how many, and a signature that
   * moves whenever a play in it is added, removed or changed — what the
   * bucket's copy of the month is compared by (docs/features/shared-server.md).
   */
  months(): { month: string; count: number; sig: string }[] {
    return this.#db
      .prepare<[], { month: string; count: number; last: number; ms: number; done: number }>(
        `SELECT strftime('%Y-%m', played_at) AS month, COUNT(*) AS count, MAX(id) AS last,
                SUM(ms_played) AS ms, SUM(completed) AS done
           FROM play_events GROUP BY month ORDER BY month`,
      )
      .all()
      .map(row => ({
        month: row.month,
        count: row.count,
        sig: `${row.count}.${row.last}.${row.ms}.${row.done}`,
      }))
  }

  /** One month's plays, oldest first, by the song's uid. */
  monthPlays(month: string): {
    uid: string
    playedAt: string
    msPlayed: number
    completed: boolean
    id: number
    clientId: string | null
  }[] {
    return this.#db
      .prepare<
        [string],
        {
          uid: string
          played_at: string
          ms_played: number
          completed: number
          id: number
          client_id: string | null
        }
      >(
        `SELECT s.uid, e.played_at, e.ms_played, e.completed, e.id, e.client_id
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE strftime('%Y-%m', e.played_at) = ?
          ORDER BY e.played_at, e.id`,
      )
      .all(month)
      .map(row => ({
        uid: row.uid,
        playedAt: row.played_at,
        msPlayed: row.ms_played,
        completed: row.completed === 1,
        id: row.id,
        clientId: row.client_id,
      }))
  }

  /**
   * Plays read back from the bucket, each counted once however often it is
   * read: the id it was archived under becomes its `client_id`. Play counts
   * are left alone — the snapshot already said them. How many were new.
   */
  restore(
    plays: readonly {
      songId: number
      playedAt: string
      msPlayed: number
      completed: boolean
      id: string
    }[],
  ): number {
    return this.#db.transaction(() => {
      let added = 0
      for (const play of plays) {
        if (this.record(play.songId, play.msPlayed, play.completed, play.playedAt, play.id)) added++
      }
      return added
    })()
  }

  /**
   * SQL fragment plus params limiting events to the requested window. `alias`
   * is the events table's, `e.`, where the query joins songs to it.
   */
  #window(range: StatsRange, alias = ''): { clause: string; params: unknown[] } {
    const days = RANGE_DAYS[range]
    if (days === null) return { clause: '1 = 1', params: [] }
    return { clause: `${alias}played_at >= datetime('now', ?)`, params: [`-${days} days`] }
  }

  build(range: StatsRange): Stats {
    const { clause, params } = this.#window(range)
    const joined = this.#window(range, 'e.')

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
           FROM songs`,
      )
      .get()

    const daily: DailyPlays[] = this.#db
      .prepare<unknown[], { date: string; plays: number; ms: number | null }>(
        /*
         * Grouped by the local day, as the axis beneath it is built and as the
         * hourly query below already does. `played_at` is stored in UTC, so
         * plainly dating it put an evening play west of Greenwich on tomorrow's
         * bar — or off the end of the chart, where `zeroFill` never looked.
         */
        `SELECT date(played_at, 'localtime') AS date, COUNT(*) AS plays,
                COALESCE(SUM(ms_played), 0) AS ms
           FROM play_events WHERE ${clause}
          GROUP BY date(played_at, 'localtime') ORDER BY date`,
      )
      .all(...params)
      .map(row => ({
        date: row.date,
        plays: row.plays,
        minutes: toMinutes(row.ms),
      }))

    // Zero-fill so the chart shows quiet days as gaps rather than skipping them.
    const days = RANGE_DAYS[range]
    const filledDaily = days === null ? daily : zeroFill(daily, days)

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

    const artistRows = this.#db
      .prepare<unknown[], ArtistPlaysRow>(
        `SELECT s.artist, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${joined.clause}
          GROUP BY s.artist ORDER BY plays DESC`,
      )
      .all(...params)

    const topTags: TopEntry[] = this.#db
      .prepare<unknown[], { key: string; plays: number; ms: number | null }>(
        `SELECT t.name AS key, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e
           JOIN song_tags st ON st.song_id = e.song_id
           JOIN tags t ON t.id = st.tag_id
          WHERE ${joined.clause}
          GROUP BY t.id ORDER BY plays DESC, key LIMIT 10`,
      )
      .all(...params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const topSongs: TopSong[] = this.#db
      .prepare<
        unknown[],
        {
          song_id: number
          title: string
          artist: string
          has_art: number
          plays: number
          ms: number | null
        }
      >(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${joined.clause}
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
      topArtists: topArtists(artistRows, 10),
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
    const dates = this.#playDates.all().map(row => row.date)
    const { longest, last } = runs(dates)
    const lastDate = dates.at(-1)
    if (lastDate === undefined) return { current: 0, longest }
    return { current: dayGap(lastDate, localDayKey(new Date())) <= 1 ? last : 0, longest }
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

/** Insert zero rows for days with no plays, so charts show a continuous axis. */
function zeroFill(rows: readonly DailyPlays[], days: number): DailyPlays[] {
  const byDate = new Map(rows.map(row => [row.date, row]))
  const out: DailyPlays[] = []
  const today = new Date()
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(today)
    day.setDate(day.getDate() - offset)
    const key = localDayKey(day)
    out.push(byDate.get(key) ?? { date: key, plays: 0, minutes: 0 })
  }
  return out
}
