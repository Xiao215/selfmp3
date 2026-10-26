import {
  listeningPersonality,
  personalityLine,
  WRAPPED_RANGE_DAYS,
  fromSqliteTime,
  type TopEntry,
  type TopSong,
  type Wrapped,
  type WrappedRange,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import {
  readerZone,
  runs,
  toMinutes,
  topArtists,
  useZones,
  windowStart,
  type ArtistPlaysRow,
} from './listening.js'

/**
 * "Wrapped, anytime" — a summary of a listening window.
 *
 * Like `StatsRepository`, everything is a GROUP BY in SQL; only the streak and
 * the personality line are worked out in JavaScript, from a handful of rows.
 * Hours and dates are the reader's wall clock (`wall_clock`, from the zone
 * the app sends) so "peak hour" means their evening, not UTC's or the
 * server's.
 */

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
  readonly #shownAs: () => ReadonlyMap<string, string>

  /** `shownAs`: as Stats takes it, so the Report's top artists join the same spellings. */
  constructor(db: Db, shownAs: () => ReadonlyMap<string, string> = () => new Map()) {
    this.#db = db
    this.#shownAs = shownAs
    useZones(db)
  }

  /** The summary of a range, its days and hours counted in `zone` (see `readerZone`). */
  build(range: WrappedRange, zone = readerZone()): Wrapped {
    const days = WRAPPED_RANGE_DAYS[range]
    // `e.` prefixed so the same clause works in every join below.
    const clause = days === null ? '1 = 1' : 'e.played_at >= @from'
    const from = days === null ? null : windowStart(days, zone)
    const params = { zone, from }

    const totals = this.#db
      .prepare<typeof params, { plays: number; ms: number | null; songs: number; days: number }>(
        `SELECT COUNT(*) AS plays,
                COALESCE(SUM(e.ms_played), 0) AS ms,
                COUNT(DISTINCT e.song_id) AS songs,
                COUNT(DISTINCT date(wall_clock(e.played_at, @zone))) AS days
           FROM play_events e WHERE ${clause}`,
      )
      .get(params)

    const topSongs = this.#db
      .prepare<typeof params, SongPlaysRow>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY s.id ORDER BY plays DESC, s.title LIMIT 5`,
      )
      .all(params)
      .map(toTopSong)

    const artistRows = this.#db
      .prepare<typeof params, ArtistPlaysRow>(
        `SELECT s.artist, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY s.artist ORDER BY plays DESC`,
      )
      .all(params)

    const topTags: TopEntry[] = this.#db
      .prepare<typeof params, { key: string; plays: number; ms: number | null }>(
        `SELECT t.name AS key, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e
           JOIN song_tags st ON st.song_id = e.song_id
           JOIN tags t ON t.id = st.tag_id
          WHERE ${clause}
          GROUP BY t.id ORDER BY plays DESC, key LIMIT 5`,
      )
      .all(params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const hourly = Array.from({ length: 24 }, () => 0)
    for (const row of this.#db
      .prepare<typeof params, { hour: string; plays: number }>(
        `SELECT strftime('%H', wall_clock(e.played_at, @zone)) AS hour, COUNT(*) AS plays
           FROM play_events e WHERE ${clause} GROUP BY hour`,
      )
      .all(params)) {
      hourly[Number(row.hour)] = row.plays
    }

    const weekday = Array.from({ length: 7 }, () => 0)
    for (const row of this.#db
      .prepare<typeof params, { day: string; plays: number }>(
        `SELECT strftime('%w', wall_clock(e.played_at, @zone)) AS day, COUNT(*) AS plays
           FROM play_events e WHERE ${clause} GROUP BY day`,
      )
      .all(params)) {
      weekday[Number(row.day)] = row.plays
    }

    const busiest = this.#db
      .prepare<typeof params, { date: string; plays: number }>(
        `SELECT date(wall_clock(e.played_at, @zone)) AS date, COUNT(*) AS plays
           FROM play_events e WHERE ${clause}
          GROUP BY date ORDER BY plays DESC, date DESC LIMIT 1`,
      )
      .get(params)

    const record = this.#db
      .prepare<typeof params, SongPlaysRow & { date: string }>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                date(wall_clock(e.played_at, @zone)) AS date, COUNT(*) AS plays, 0 AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
          GROUP BY s.id, date ORDER BY plays DESC, date DESC, s.title LIMIT 1`,
      )
      .get(params)

    // "Discovered": added inside the window, and played enough to mean it.
    // For all time that is every song with three plays, which is honest too.
    const discovered = this.#db
      .prepare<typeof params, SongPlaysRow>(
        `SELECT s.id AS song_id, s.title, s.artist, s.has_art,
                COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${clause}
            AND ${days === null ? '1 = 1' : 's.added_at >= @from'}
          GROUP BY s.id HAVING COUNT(*) >= 3
          ORDER BY plays DESC, s.title LIMIT 10`,
      )
      .all(params)
      .map(toTopSong)

    const dates = this.#db
      .prepare<typeof params, { date: string }>(
        `SELECT DISTINCT date(wall_clock(e.played_at, @zone)) AS date
           FROM play_events e WHERE ${clause} ORDER BY date`,
      )
      .all(params)
      .map(row => row.date)
    const longestStreakDays = runs(dates).longest

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
      from: from === null ? null : toIso(from),
      to: new Date().toISOString(),
      totals: {
        plays,
        minutes,
        songsPlayed: totals?.songs ?? 0,
        activeDays: totals?.days ?? 0,
      },
      topSongs,
      topArtists: topArtists(artistRows, 5, this.#shownAs()),
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

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) as an ISO string. */
function toIso(sqlite: string): string {
  const parsed = fromSqliteTime(sqlite)
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
