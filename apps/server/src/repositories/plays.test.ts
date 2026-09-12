import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from './songs.js'
import { sqliteTime, StatsRepository } from './stats.js'

/**
 * Plays reported late, against a real in-memory SQLite built from the real
 * migrations.
 *
 * The two promises a phone that was offline relies on: a play lands on the
 * day it happened rather than the day it was sent, and a play sent twice —
 * because the first response was lost — counts once.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, createLogger('silent'))
  db.prepare(
    `INSERT INTO songs (id, path, title, artist, album, duration) VALUES (1, 'a.mp3', 'Sunrise', 'Aurora Lane', '', 190)`,
  ).run()
  return db
}

/** What the route does, minus HTTP. */
function recordPlay(
  db: Database.Database,
  stats: StatsRepository,
  songs: SongRepository,
  playedAtIso?: string,
  clientId: string | null = null,
): boolean {
  const at = sqliteTime(playedAtIso)
  return db.transaction(() => {
    const inserted = stats.record(1, 120_000, true, at, clientId)
    if (inserted) songs.recordPlay(1, at)
    return inserted
  })()
}

describe('plays reported late', () => {
  let db: Database.Database
  let stats: StatsRepository
  let songs: SongRepository

  beforeEach(() => {
    db = makeDb()
    stats = new StatsRepository(db)
    songs = new SongRepository(db)
  })

  it('stores the time the play happened, not the time it arrived', () => {
    recordPlay(db, stats, songs, '2026-09-01T08:30:00.000Z', 'phone-play-0001')
    const row = db.prepare('SELECT played_at FROM play_events').get() as { played_at: string }
    expect(row.played_at).toBe('2026-09-01 08:30:00')
  })

  it('counts a resent play once', () => {
    expect(recordPlay(db, stats, songs, '2026-09-01T08:30:00.000Z', 'phone-play-0001')).toBe(true)
    expect(recordPlay(db, stats, songs, '2026-09-01T08:30:00.000Z', 'phone-play-0001')).toBe(false)

    const events = db.prepare('SELECT COUNT(*) AS n FROM play_events').get() as { n: number }
    expect(events.n).toBe(1)
    expect(songs.byId(1)?.playCount).toBe(1)
  })

  it('never lets a late play move "last played" backwards', () => {
    recordPlay(db, stats, songs) // just now
    const recent = songs.byId(1)?.lastPlayedAt
    recordPlay(db, stats, songs, '2026-01-01T00:00:00.000Z', 'phone-play-0002')

    expect(songs.byId(1)?.lastPlayedAt).toBe(recent)
    expect(songs.byId(1)?.playCount).toBe(2)
  })

  it('moves "last played" forward when the late play is the newest', () => {
    recordPlay(db, stats, songs, '2026-01-01T00:00:00.000Z', 'phone-play-0003')
    recordPlay(db, stats, songs, '2026-02-01T00:00:00.000Z', 'phone-play-0004')
    expect(songs.byId(1)?.lastPlayedAt).toContain('2026-02-01')
  })

  it('still records plays with no client id, every time', () => {
    recordPlay(db, stats, songs)
    recordPlay(db, stats, songs)
    expect(songs.byId(1)?.playCount).toBe(2)
  })
})

/**
 * Which bar of the chart a play lands on.
 *
 * `played_at` is stored in UTC and the axis under the chart is built from
 * local dates, so the grouping has to say which it means. Dating the column
 * plainly put an evening play west of Greenwich on tomorrow — and tomorrow is
 * off the end of the chart, so it vanished.
 */
describe('the daily chart, in the timezone the listener is in', () => {
  it('counts an evening play on the evening it happened', () => {
    const db = makeDb()
    const stats = new StatsRepository(db)
    const songs = new SongRepository(db)

    // 20:00 local, whatever local is here.
    const evening = new Date()
    evening.setHours(20, 0, 0, 0)
    // Yesterday evening, so "today" cannot mask a UTC/local disagreement.
    evening.setDate(evening.getDate() - 1)
    recordPlay(db, stats, songs, evening.toISOString(), 'phone-play-evening')

    const expected = [
      evening.getFullYear(),
      String(evening.getMonth() + 1).padStart(2, '0'),
      String(evening.getDate()).padStart(2, '0'),
    ].join('-')

    const day = stats.build('30d').daily.find(row => row.date === expected)
    expect(day?.plays).toBe(1)
  })
})

describe('sqliteTime', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z')

  it('converts ISO with an offset to UTC', () => {
    expect(sqliteTime('2026-09-10T08:00:00-04:00', now)).toBe('2026-09-10 12:00:00')
  })

  it('treats missing, unreadable and future times as now', () => {
    expect(sqliteTime(undefined, now)).toBeNull()
    expect(sqliteTime('yesterday-ish', now)).toBeNull()
    expect(sqliteTime('2026-09-11T00:00:00.000Z', now)).toBeNull()
  })
})
