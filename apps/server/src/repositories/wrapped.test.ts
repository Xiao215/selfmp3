import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { longestRun, WrappedRepository } from './wrapped.js'

/**
 * Runs the real migrations on an in-memory database and seeds play events
 * with explicit timestamps, so every number the summary reports can be
 * checked by hand against the rows below.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db, createLogger('silent'))

  const insertSong = db.prepare(
    `INSERT INTO songs (id, path, title, artist, added_at, play_count)
     VALUES (@id, @path, @title, @artist, datetime('now', @added), @plays)`,
  )
  insertSong.run({
    id: 1,
    path: 'a',
    title: 'Midnight Drive',
    artist: 'Aurora Lane',
    added: '-400 days',
    plays: 6,
  })
  insertSong.run({
    id: 2,
    path: 'b',
    title: 'Sunrise',
    artist: 'Aurora Lane',
    added: '-400 days',
    plays: 2,
  })
  insertSong.run({
    id: 3,
    path: 'c',
    title: 'Nocturne',
    artist: 'Klara Feld',
    added: '-3 days',
    plays: 3,
  })
  insertSong.run({
    id: 4,
    path: 'd',
    title: 'Old Favourite',
    artist: 'Ghost',
    added: '-400 days',
    plays: 1,
  })

  db.prepare("INSERT INTO tags (id, name) VALUES (1, 'chill'), (2, 'piano')").run()
  db.prepare('INSERT INTO song_tags VALUES (1, 1), (3, 1), (3, 2)').run()

  const insertEvent = db.prepare(
    "INSERT INTO play_events (song_id, played_at, ms_played) VALUES (?, datetime('now', ?), ?)",
  )
  // Song 1: six plays over the last week, three of them on the same day two
  // days ago, all at 23:xx local yesterday-ish. Using whole-day offsets keeps
  // local dates stable regardless of the machine's time zone, as long as the
  // events land well inside a day — so they are placed at "now", not midnight.
  insertEvent.run(1, '-1 days', 240_000)
  insertEvent.run(1, '-2 days', 240_000)
  insertEvent.run(1, '-2 days', 240_000)
  insertEvent.run(1, '-2 days', 240_000)
  insertEvent.run(1, '-3 days', 240_000)
  insertEvent.run(1, '-4 days', 240_000)
  // Song 3, added three days ago and played three times since: a discovery.
  insertEvent.run(3, '-1 days', 60_000)
  insertEvent.run(3, '-2 days', 60_000)
  insertEvent.run(3, '-3 days', 60_000)
  // Song 2: twice this month, outside the week.
  insertEvent.run(2, '-10 days', 120_000)
  insertEvent.run(2, '-12 days', 120_000)
  // Song 4: once, long ago.
  insertEvent.run(4, '-300 days', 180_000)

  return db
}

describe('WrappedRepository', () => {
  const repo = new WrappedRepository(makeDb())

  it('totals the week by hand', () => {
    const week = repo.build('week')
    expect(week.totals.plays).toBe(9)
    // 6 × 4 min + 3 × 1 min.
    expect(week.totals.minutes).toBe(27)
    expect(week.totals.songsPlayed).toBe(2)
    expect(week.totals.activeDays).toBe(4)
    expect(week.from).not.toBeNull()
  })

  it('ranks songs, artists and tags inside the window only', () => {
    const month = repo.build('month')
    expect(month.topSongs.map(song => [song.songId, song.plays])).toEqual([
      [1, 6],
      [3, 3],
      [2, 2],
    ])
    expect(month.topArtists.map(entry => [entry.key, entry.plays])).toEqual([
      ['Aurora Lane', 8],
      ['Klara Feld', 3],
    ])
    // chill: song 1 (6) + song 3 (3); piano: song 3 only.
    expect(month.topTags.map(entry => [entry.key, entry.plays])).toEqual([
      ['chill', 9],
      ['piano', 3],
    ])
  })

  it('holds three months between the month and the year', () => {
    // Everything but song 4's one play, three hundred days ago.
    const quarter = repo.build('quarter')
    expect(quarter.range).toBe('quarter')
    expect(quarter.totals.plays).toBe(11)
    expect(quarter.topSongs.map(song => song.songId)).toEqual([1, 3, 2])
    expect(repo.build('year').totals.plays).toBe(12)
  })

  it('finds the song you played most in one day', () => {
    const week = repo.build('week')
    expect(week.mostInOneDay?.songId).toBe(1)
    expect(week.mostInOneDay?.plays).toBe(3)
    expect(week.busiestDate?.plays).toBe(4)
    expect(week.busiestDate?.date).toBe(week.mostInOneDay?.date)
  })

  it('counts a discovery only when it was added in the window', () => {
    expect(repo.build('week').discovered.map(song => song.songId)).toEqual([3])
    // Song 1 has six plays this year but was added long before it.
    expect(repo.build('month').discovered.map(song => song.songId)).toEqual([3])
    // All time: everything with three plays counts.
    expect(repo.build('all').discovered.map(song => song.songId)).toEqual([1, 3])
  })

  it('measures the streak inside the window', () => {
    // Days -1 through -4 all have plays: a four-day run.
    expect(repo.build('week').longestStreakDays).toBe(4)
    expect(repo.build('all').longestStreakDays).toBe(4)
  })

  it('reports a peak hour and weekday, or null with no plays', () => {
    const week = repo.build('week')
    expect(week.peakHour).not.toBeNull()
    expect(week.peakWeekday).not.toBeNull()

    const empty = new WrappedRepository(
      (() => {
        const db = new Database(':memory:')
        migrate(db, createLogger('silent'))
        return db
      })(),
    ).build('year')
    expect(empty.totals.plays).toBe(0)
    expect(empty.peakHour).toBeNull()
    expect(empty.busiestDate).toBeNull()
    expect(empty.mostInOneDay).toBeNull()
    expect(empty.personality.traits).toEqual(['Casual listener'])
  })

  it('derives a personality line from the same numbers', () => {
    const all = repo.build('all')
    // Twelve plays, five distinct songs' top five hold all of them.
    expect(all.personality.traits).toContain('Repeat listener')
    expect(all.personality.line).toContain('Repeat listener')
  })
})

describe('WrappedRepository windows', () => {
  it('covers exactly as many local days as the label claims', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.prepare(
      "INSERT INTO songs (id, path, title, added_at) VALUES (1, 'a', 'A', datetime('now'))",
    ).run()

    // One play per day for a fortnight, at the current time of day.
    const insert = db.prepare(
      "INSERT INTO play_events (song_id, played_at, ms_played) VALUES (1, datetime('now', ?), 60000)",
    )
    for (let day = 0; day < 14; day++) insert.run(`-${day} days`)

    const week = new WrappedRepository(db).build('week')
    // A window counted back in 24-hour steps would straddle eight dates and
    // contradict its own "Last 7 days" heading.
    expect(week.totals.activeDays).toBe(7)
    expect(week.totals.plays).toBe(7)
    expect(week.longestStreakDays).toBe(7)
  })

  it('counts three months as ninety local days', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.prepare(
      "INSERT INTO songs (id, path, title, added_at) VALUES (1, 'a', 'A', datetime('now', '-200 days'))",
    ).run()
    const insert = db.prepare(
      "INSERT INTO play_events (song_id, played_at, ms_played) VALUES (1, datetime('now', ?), 60000)",
    )
    for (let day = 0; day < 120; day++) insert.run(`-${day} days`)

    const quarter = new WrappedRepository(db).build('quarter')
    expect(quarter.totals.activeDays).toBe(90)
    expect(quarter.totals.plays).toBe(90)
  })
})

describe('longestRun', () => {
  it('counts consecutive dates', () => {
    expect(longestRun([])).toBe(0)
    expect(longestRun(['2026-01-01'])).toBe(1)
    expect(longestRun(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06'])).toBe(
      3,
    )
  })
})
