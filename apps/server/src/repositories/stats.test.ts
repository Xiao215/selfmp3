import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
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
