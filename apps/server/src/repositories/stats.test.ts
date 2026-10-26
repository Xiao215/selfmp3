import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { formatHlc, joinedNames } from '@selfmp3/shared'
import { NamesRepository } from './names.js'
import { SongRepository } from './songs.js'
import { StatsRepository } from './stats.js'
import { WrappedRepository } from './wrapped.js'

/**
 * Stats › Month and the Month report must count the same plays. A play just
 * before the local midnight that opens the thirty days sits inside a rolling
 * "now minus thirty days", and Stats used to count it.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db, createLogger('silent'))
  db.prepare(
    "INSERT INTO songs (id, path, title, artist, added_at) VALUES (1, 'a', 'Song', 'Artist', datetime('now', '-400 days'))",
  ).run()
  const insert = db.prepare(
    `INSERT INTO play_events (song_id, played_at, ms_played)
     VALUES (1, datetime('now', 'localtime', 'start of day', ?, ?, 'utc'), 60000)`,
  )
  // A minute before the window opens, then a minute after it, then today.
  insert.run('-29 days', '-1 minutes')
  insert.run('-29 days', '+1 minutes')
  insert.run('+0 days', '+1 minutes')
  return db
}

describe('StatsRepository windows', () => {
  const db = makeDb()
  const stats = new StatsRepository(db)
  const wrapped = new WrappedRepository(db)

  it('opens the month at a local midnight, as the report does', () => {
    const month = stats.build('30d')
    expect(month.totals.plays).toBe(2)
    expect(month.totals.plays).toBe(wrapped.build('month').totals.plays)
  })

  it('totals what its own daily rows add up to', () => {
    const month = stats.build('30d')
    expect(month.daily).toHaveLength(30)
    expect(month.daily.reduce((sum, day) => sum + day.plays, 0)).toBe(month.totals.plays)
  })

  it('counts everything for all time', () => {
    expect(stats.build('all').totals.plays).toBe(3)
  })
})

/**
 * One artist under two spellings, joined by their other names (shared
 * artistJoins.ts), is one entry in Stats and the Report, plays summed —
 * counted the way the container wires it, from the songs and the names kept.
 */
describe('Top artists, joined by other names', () => {
  function joinedDb(): {
    stats: StatsRepository
    wrapped: WrappedRepository
    names: NamesRepository
  } {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    const song = db.prepare(
      "INSERT INTO songs (id, path, title, artist, added_at) VALUES (?, ?, 'Song', ?, datetime('now'))",
    )
    song.run(1, 'a', 'Yorushika')
    song.run(2, 'b', 'Yorushika')
    song.run(3, 'c', 'ヨルシカ')
    song.run(4, 'd', 'YOASOBI')
    const play = db.prepare(
      "INSERT INTO play_events (song_id, played_at, ms_played) VALUES (?, datetime('now'), 60000)",
    )
    for (const id of [1, 3, 3, 4, 4, 4, 4]) play.run(id)
    const songs = new SongRepository(db)
    const names = new NamesRepository(db)
    const shownAs = () => joinedNames(songs.all(), names.joinNames())
    return {
      stats: new StatsRepository(db, shownAs),
      wrapped: new WrappedRepository(db, shownAs),
      names,
    }
  }
  const top = (entries: readonly { key: string; plays: number }[]) =>
    entries.map(entry => [entry.key, entry.plays])

  it('keeps two spellings apart while nothing joins them', () => {
    const { stats } = joinedDb()
    expect(top(stats.build('all').topArtists)).toEqual([
      ['YOASOBI', 4],
      ['ヨルシカ', 2],
      ['Yorushika', 1],
    ])
  })

  it('sums the plays under the bigger artist once its other names hold the smaller', () => {
    const { stats, wrapped, names } = joinedDb()
    names.takeArtistNames(
      'yorushika',
      ['ヨルシカ'],
      formatHlc({ ms: 1_000, counter: 0, device: 'web-1' }),
    )
    expect(top(stats.build('all').topArtists)).toEqual([
      ['YOASOBI', 4],
      ['Yorushika', 3],
    ])
    expect(top(wrapped.build('all').topArtists)).toEqual(top(stats.build('all').topArtists))
  })

  it('leaves names MusicBrainz found to ask first', () => {
    const { stats, names } = joinedDb()
    names.takeArtistNames(
      'yorushika',
      ['ヨルシカ'],
      formatHlc({ ms: 0, counter: 0, device: 'server-1' }),
    )
    expect(stats.build('all').topArtists).toHaveLength(3)
  })
})

describe('StatsRepository.songPlays', () => {
  it('folds one song’s plays into totals and UTC hours, and leaves other songs out', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.prepare("INSERT INTO songs (id, path, title) VALUES (1, 'a', 'A'), (2, 'b', 'B')").run()
    const insert = db.prepare(
      'INSERT INTO play_events (song_id, played_at, ms_played) VALUES (?, ?, ?)',
    )
    insert.run(1, '2026-08-10 23:05:00', 60_000)
    insert.run(1, '2026-08-10 23:50:00', 30_000)
    insert.run(1, '2026-09-01 08:00:00', 90_000)
    insert.run(2, '2026-08-11 12:00:00', 1_000)
    const stats = new StatsRepository(db)

    expect(stats.songPlays(1)).toEqual({
      plays: 3,
      msPlayed: 180_000,
      firstPlayedAt: '2026-08-10 23:05:00',
      lastPlayedAt: '2026-09-01 08:00:00',
      hours: [
        { at: '2026-08-10 23:00:00', plays: 2 },
        { at: '2026-09-01 08:00:00', plays: 1 },
      ],
    })
    expect(stats.songPlays(3)).toEqual({
      plays: 0,
      msPlayed: 0,
      firstPlayedAt: null,
      lastPlayedAt: null,
      hours: [],
    })
  })
})
