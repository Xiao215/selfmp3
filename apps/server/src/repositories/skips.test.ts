import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from './songs.js'
import { SyncRepository } from './sync.js'

/**
 * How far into a song each skip happened, against a real in-memory SQLite
 * built from the real migrations.
 *
 * Every client has always sent `atSeconds` and the server has always thrown it
 * away, so "songs I always skip" could not tell a song you dislike from one you
 * simply moved on from near the end. These are the three things that has to be
 * true now: the number survives, the running count nothing else reads is
 * unchanged, and a skip sent twice still counts once.
 */

interface SkipRow {
  song_id: number
  at_seconds: number
}

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
function recordSkip(
  db: Database.Database,
  sync: SyncRepository,
  songs: SongRepository,
  atSeconds: number,
  clientId?: string,
): boolean {
  return db.transaction(() => {
    if (clientId !== undefined && !sync.countSkip(clientId)) return false
    songs.recordSkip(1, atSeconds)
    return true
  })()
}

describe('a skip, and how far in it was', () => {
  let db: Database.Database
  let sync: SyncRepository
  let songs: SongRepository

  beforeEach(() => {
    db = makeDb()
    sync = new SyncRepository(db)
    songs = new SongRepository(db)
  })

  it('keeps the second the skip happened at', () => {
    recordSkip(db, sync, songs, 4.2, 'phone-skip-0001')
    const row = db.prepare('SELECT song_id, at_seconds FROM skip_events').get() as SkipRow
    expect(row.song_id).toBe(1)
    expect(row.at_seconds).toBeCloseTo(4.2)
  })

  it('tells four seconds in apart from most of the way through', () => {
    recordSkip(db, sync, songs, 4, 'phone-skip-0002')
    recordSkip(db, sync, songs, 179, 'phone-skip-0003')

    const rows = db
      .prepare('SELECT song_id, at_seconds FROM skip_events ORDER BY id')
      .all() as SkipRow[]
    expect(rows.map(row => row.at_seconds)).toEqual([4, 179])
  })

  it('still moves the count that smart rules and forgotten gems read', () => {
    recordSkip(db, sync, songs, 4, 'phone-skip-0004')
    recordSkip(db, sync, songs, 9, 'phone-skip-0005')
    expect(songs.byId(1)?.skipCount).toBe(2)
  })

  it('counts a resent skip once, and stores it once', () => {
    expect(recordSkip(db, sync, songs, 4, 'phone-skip-0006')).toBe(true)
    expect(recordSkip(db, sync, songs, 4, 'phone-skip-0006')).toBe(false)

    const events = db.prepare('SELECT COUNT(*) AS n FROM skip_events').get() as { n: number }
    expect(events.n).toBe(1)
    expect(songs.byId(1)?.skipCount).toBe(1)
  })

  it('records a skip with no client id, every time', () => {
    recordSkip(db, sync, songs, 4)
    recordSkip(db, sync, songs, 4)
    expect(songs.byId(1)?.skipCount).toBe(2)
    const events = db.prepare('SELECT COUNT(*) AS n FROM skip_events').get() as { n: number }
    expect(events.n).toBe(2)
  })

  it('counts a skip from a client too old to say where, at zero', () => {
    songs.recordSkip(1)
    const row = db.prepare('SELECT at_seconds FROM skip_events').get() as SkipRow
    expect(row.at_seconds).toBe(0)
    expect(songs.byId(1)?.skipCount).toBe(1)
  })

  it('takes a song’s skips with it when the song is deleted', () => {
    recordSkip(db, sync, songs, 4, 'phone-skip-0007')
    db.prepare('DELETE FROM songs WHERE id = 1').run()
    const events = db.prepare('SELECT COUNT(*) AS n FROM skip_events').get() as { n: number }
    expect(events.n).toBe(0)
  })
})
