import {
  countsAsPlay,
  DAY_STARTS_AT_HOUR,
  toSqliteTime,
  type DailyPlays,
  type HourlyPlays,
  type SongHistory,
  type Stats,
  type StatsRange,
  type TopEntry,
  type TopSong,
} from '@selfmp3/shared'
import type { Db } from '../db/index.js'
import {
  dayGap,
  dayKeyBefore,
  readerZone,
  runs,
  toMinutes,
  topArtists,
  useZones,
  windowStart,
  zoneDayKey,
  type ArtistPlaysRow,
} from './listening.js'

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

/** Before this, a play's time is a clock that was never set (1970, year 1), not history. */
const PLAYS_BEGIN = Date.UTC(2000, 0, 1)

/**
 * A client's ISO 8601 timestamp as SQLite's UTC `YYYY-MM-DD HH:MM:SS`, the
 * format `datetime('now')` writes and every range query compares against.
 *
 * Null means "use now": for no timestamp, an unreadable one, one in the
 * future, and one from before anyone could have played it here. A phone whose
 * clock runs ahead must not put a play in the future, where it would top every
 * "recently played" list until the future arrived; one whose clock went back
 * to 1970 must not stretch every all-time range back to then.
 */
export function sqliteTime(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms) || ms > now || ms < PLAYS_BEGIN) return null
  return toSqliteTime(ms)
}

/** How far ahead of this server's clock a play may say it was and still be taken for now. */
const PLAYS_AHEAD_MS = 24 * 60 * 60 * 1000

/**
 * Why nobody could have made this play, or null for one somebody could:
 * nothing like a play heard (shared `countsAsPlay`, which running to the end
 * does not get round), or a time no clock that was ever set gives — before
 * 2000, or more than a day ahead. Those used to be recorded as now.
 */
export function impossiblePlay(
  play: { readonly msPlayed: number; readonly completed: boolean; readonly playedAt?: string },
  durationSeconds: number,
  now = Date.now(),
): string | null {
  if (
    !countsAsPlay(heardMs(play.msPlayed, durationSeconds) / 1000, durationSeconds, play.completed)
  ) {
    return 'not enough of the song was heard to be a play'
  }
  if (play.playedAt !== undefined) {
    const ms = Date.parse(play.playedAt)
    if (Number.isNaN(ms) || ms < PLAYS_BEGIN || ms > now + PLAYS_AHEAD_MS) {
      return 'no clock could have played it then'
    }
  }
  return null
}

/** How far past a song's length a play may run: a second's jitter per tick, and some. */
const PLAY_SLACK_MS = 10_000

/**
 * What a play says it heard, held to the song's own length: one play of a
 * one-second song is never a day of listening in Stats. A song whose length
 * is not known yet keeps what it was sent, which the schema already caps.
 */
export function heardMs(msPlayed: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return msPlayed
  return Math.min(msPlayed, Math.round(durationSeconds * 1000) + PLAY_SLACK_MS)
}

export class StatsRepository {
  readonly #db: Db
  readonly #record
  readonly #overlapping
  readonly #playDates
  readonly #latestPlay
  readonly #shownAs: () => ReadonlyMap<string, string>

  /**
   * `shownAs`: each joined artist's key → the name it is shown by (shared
   * `joinedNames`), so Top artists counts one artist under two spellings once.
   */
  constructor(db: Db, shownAs: () => ReadonlyMap<string, string> = () => new Map()) {
    this.#db = db
    this.#shownAs = shownAs
    useZones(db)
    this.#record = db.prepare(
      `INSERT OR IGNORE INTO play_events (song_id, ms_played, completed, played_at, client_id)
       VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?)`,
    )
    // Plays end when they are recorded, so two of one song overlap when their
    // ends are closer together than the shorter of them lasted, less a second
    // for times kept to the second.
    this.#overlapping = db.prepare<
      { songId: number; at: string | null; ms: number; clientId: string | null },
      { n: number }
    >(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM play_events
          WHERE song_id = @songId
            AND (@clientId IS NULL OR client_id IS NOT @clientId)
            AND played_at >= datetime(COALESCE(@at, 'now'), '-' || (@ms / 1000 + 1) || ' seconds')
            AND played_at <= datetime(COALESCE(@at, 'now'), '+' || (@ms / 1000 + 1) || ' seconds')
            AND abs(unixepoch(played_at) - unixepoch(COALESCE(@at, 'now'))) * 1000
                  < min(ms_played, @ms) - 1000
          LIMIT 1
       )`,
    )
    this.#playDates = db.prepare<{ zone: string }, { date: string }>(
      'SELECT DISTINCT date(wall_clock(played_at, @zone)) AS date FROM play_events ORDER BY date',
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
   * Whether this song has another play recorded across the same stretch of
   * time: one person cannot hear a song twice at once, so it is a copy of
   * that play (a phone's log carried ten thousand plays of one three-second
   * song, all ending at the same instant). A resend under its own `clientId`
   * is not counted against itself: `record` already knows it.
   */
  overlaps(
    songId: number,
    msPlayed: number,
    playedAt: string | null = null,
    clientId: string | null = null,
  ): boolean {
    return (this.#overlapping.get({ songId, at: playedAt, ms: msPlayed, clientId })?.n ?? 0) > 0
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
   * moves whenever a play in it is added, removed or changed — given to
   * another song too, as a folded copy's plays are (`SongMerge`) — what the
   * bucket's copy of the month is compared by (docs/features/shared-server.md).
   */
  months(): { month: string; count: number; sig: string }[] {
    return this.#db
      .prepare<
        [],
        { month: string; count: number; last: number; ms: number; done: number; songs: number }
      >(
        `SELECT strftime('%Y-%m', played_at) AS month, COUNT(*) AS count, MAX(id) AS last,
                SUM(ms_played) AS ms, SUM(completed) AS done, SUM(song_id) AS songs
           FROM play_events GROUP BY month ORDER BY month`,
      )
      .all()
      .map(row => ({
        month: row.month,
        count: row.count,
        sig: `${row.count}.${row.last}.${row.ms}.${row.done}.${row.songs}`,
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
   * SQL fragment limiting events to the requested window: today and the days
   * before it, from a midnight in the reader's zone, as the daily chart is
   * drawn and as Wrapped counts. A rolling `now - N days` spanned N + 1
   * calendar days, so Stats › Month counted a partial day more than the
   * Month report. `alias` is the events table's, `e.`, where the query joins
   * songs to it; the window's start is the `@from` parameter.
   */
  #window(range: StatsRange, alias = ''): string {
    return RANGE_DAYS[range] === null ? '1 = 1' : `${alias}played_at >= @from`
  }

  /**
   * The stats for a range, with days and hours counted in `zone` (an IANA
   * name, see `readerZone`): the reader's, not the server's.
   */
  build(range: StatsRange, zone = readerZone()): Stats {
    const clause = this.#window(range)
    const joined = this.#window(range, 'e.')
    const days = RANGE_DAYS[range]
    const params = { zone, from: days === null ? null : windowStart(days, zone) }

    const totals = this.#db
      .prepare<typeof params, { plays: number; ms: number | null; songs: number }>(
        `SELECT COUNT(*) AS plays,
                COALESCE(SUM(ms_played), 0) AS ms,
                COUNT(DISTINCT song_id) AS songs
           FROM play_events WHERE ${clause}`,
      )
      .get(params)

    const library = this.#db
      .prepare<[], { count: number; duration: number | null; never: number }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(duration), 0) AS duration,
                COALESCE(SUM(CASE WHEN play_count = 0 THEN 1 ELSE 0 END), 0) AS never
           FROM songs`,
      )
      .get()

    const daily: DailyPlays[] = this.#db
      .prepare<typeof params, { date: string; plays: number; ms: number | null }>(
        /*
         * Grouped by the reader's day, as the axis beneath it is built and as
         * the hourly query below already does. `played_at` is stored in UTC,
         * so plainly dating it put an evening play west of Greenwich on
         * tomorrow's bar — or off the end of the chart, where `zeroFill` never
         * looked.
         */
        `SELECT date(wall_clock(played_at, @zone)) AS date, COUNT(*) AS plays,
                COALESCE(SUM(ms_played), 0) AS ms
           FROM play_events WHERE ${clause}
          GROUP BY 1 ORDER BY date`,
      )
      .all(params)
      .map(row => ({
        date: row.date,
        plays: row.plays,
        minutes: toMinutes(row.ms),
      }))

    // Zero-fill so the chart shows quiet days as gaps rather than skipping them.
    const filledDaily = days === null ? daily : zeroFill(daily, days, zone)

    const hourlyRows = this.#db
      .prepare<typeof params, { hour: string; plays: number }>(
        `SELECT strftime('%H', wall_clock(played_at, @zone)) AS hour, COUNT(*) AS plays
           FROM play_events WHERE ${clause}
          GROUP BY hour ORDER BY hour`,
      )
      .all(params)

    const hourly: HourlyPlays[] = Array.from({ length: 24 }, (_, hour) => ({ hour, plays: 0 }))
    for (const row of hourlyRows) {
      const hour = Number(row.hour)
      const slot = hourly[hour]
      if (slot) hourly[hour] = { hour, plays: row.plays }
    }

    const artistRows = this.#db
      .prepare<typeof params, ArtistPlaysRow>(
        `SELECT s.artist, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e JOIN songs s ON s.id = e.song_id
          WHERE ${joined}
          GROUP BY s.artist ORDER BY plays DESC`,
      )
      .all(params)

    const topTags: TopEntry[] = this.#db
      .prepare<typeof params, { key: string; plays: number; ms: number | null }>(
        `SELECT t.name AS key, COUNT(*) AS plays, COALESCE(SUM(e.ms_played), 0) AS ms
           FROM play_events e
           JOIN song_tags st ON st.song_id = e.song_id
           JOIN tags t ON t.id = st.tag_id
          WHERE ${joined}
          GROUP BY t.id ORDER BY plays DESC, key LIMIT 10`,
      )
      .all(params)
      .map(row => ({ key: row.key, plays: row.plays, minutes: toMinutes(row.ms) }))

    const topSongs: TopSong[] = this.#db
      .prepare<
        typeof params,
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
          WHERE ${joined}
          GROUP BY s.id ORDER BY plays DESC, s.title LIMIT 20`,
      )
      .all(params)
      .map(row => ({
        songId: row.song_id,
        title: row.title,
        artist: row.artist,
        hasArt: row.has_art === 1,
        plays: row.plays,
        minutes: toMinutes(row.ms),
      }))

    const streaks = this.#streaks(zone)

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
      topArtists: topArtists(artistRows, 10, this.#shownAs()),
      topTags,
      topSongs,
    }
  }

  /**
   * Current and longest run of consecutive days with at least one play.
   *
   * Computed over distinct dates in the reader's zone. Today not yet having
   * a play does not break the current streak — you might still put something
   * on this evening.
   */
  #streaks(zone: string): { current: number; longest: number } {
    const dates = this.#playDates.all({ zone }).map(row => row.date)
    const { longest, last } = runs(dates)
    const lastDate = dates.at(-1)
    if (lastDate === undefined) return { current: 0, longest }
    return { current: dayGap(lastDate, zoneDayKey(Date.now(), zone)) <= 1 ? last : 0, longest }
  }

  /** Plays a day since `from` (a UTC date), for the owner's admin page. */
  playsByDay(from: string): Map<string, number> {
    const rows = this.#db
      .prepare<[string], { day: string; plays: number }>(
        `SELECT substr(played_at, 1, 10) AS day, COUNT(*) AS plays
           FROM play_events WHERE played_at >= ? GROUP BY day`,
      )
      .all(from)
    return new Map(rows.map(row => [row.day, row.plays]))
  }

  /**
   * The last `days` days of plays by song, local hour, kind of day and how
   * many weeks ago, for "Usually at this hour" (services/usualHours.ts).
   * `zone` is the asking device's (see `readerZone`): the hours are the
   * listener's, not the server's, and half a year of them crosses a clock
   * change that one offset would have put an hour out. A day starts at
   * `DAY_STARTS_AT_HOUR` (shared usual.ts), so one on a Saturday morning is
   * Friday night's.
   */
  usualPlays(
    zone: string,
    days: number,
  ): { uid: string; hour: number; weekend: boolean; weeksAgo: number; plays: number }[] {
    return this.#db
      .prepare<
        [string, string, string],
        { uid: string; hour: number; weekend: number; weeksAgo: number; plays: number }
      >(
        `SELECT s.uid AS uid,
                CAST(strftime('%H', e.local) AS INTEGER) AS hour,
                strftime('%w', e.local, ?) IN ('0', '6') AS weekend,
                CAST((julianday('now') - julianday(e.played_at)) / 7 AS INTEGER) AS weeksAgo,
                COUNT(*) AS plays
           FROM (SELECT song_id, played_at, wall_clock(played_at, ?) AS local
                   FROM play_events WHERE played_at >= datetime('now', ?)) e
           JOIN songs s ON s.id = e.song_id
          GROUP BY s.uid, hour, weekend, weeksAgo`,
      )
      .all(`-${DAY_STARTS_AT_HOUR} hours`, zone, `-${days} days`)
      .map(row => ({ ...row, weekend: row.weekend === 1 }))
  }

  /**
   * One song's plays, folded for its page (`SongHistory`): how many, how long,
   * the first and the last, and how many began in each UTC hour. Hours rather
   * than days or weeks, so the device can fold them into weeks in its own time
   * zone; a song played a thousand times is still well under a thousand rows.
   */
  songPlays(songId: number): Omit<SongHistory, 'songId' | 'cameWith'> {
    const totals = this.#db
      .prepare<
        [number],
        { plays: number; ms: number | null; first: string | null; last: string | null }
      >(
        `SELECT COUNT(*) AS plays, SUM(ms_played) AS ms,
                MIN(played_at) AS first, MAX(played_at) AS last
           FROM play_events WHERE song_id = ?`,
      )
      .get(songId)
    const hours = this.#db
      .prepare<[number], { at: string; plays: number }>(
        `SELECT strftime('%Y-%m-%d %H:00:00', played_at) AS at, COUNT(*) AS plays
           FROM play_events WHERE song_id = ? GROUP BY at ORDER BY at`,
      )
      .all(songId)
    return {
      plays: totals?.plays ?? 0,
      msPlayed: Math.round(totals?.ms ?? 0),
      firstPlayedAt: totals?.first ?? null,
      lastPlayedAt: totals?.last ?? null,
      hours,
    }
  }
}

/** Insert zero rows for days with no plays, so charts show a continuous axis. */
function zeroFill(rows: readonly DailyPlays[], days: number, zone: string): DailyPlays[] {
  const byDate = new Map(rows.map(row => [row.date, row]))
  const out: DailyPlays[] = []
  const today = zoneDayKey(Date.now(), zone)
  for (let offset = days - 1; offset >= 0; offset--) {
    const key = dayKeyBefore(today, offset)
    out.push(byDate.get(key) ?? { date: key, plays: 0, minutes: 0 })
  }
  return out
}
