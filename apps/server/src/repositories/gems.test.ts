import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { gemsThresholdDays } from '@selfmp3/shared'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { GemsRepository } from './gems.js'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  migrate(db, createLogger('silent'))

  const insert = db.prepare(
    `INSERT INTO songs (id, path, title, added_at, play_count, loved, last_played_at)
     VALUES (@id, @path, @title, datetime('now', @added), @plays, @loved,
             CASE WHEN @last IS NULL THEN NULL ELSE datetime('now', @last) END)`,
  )
  // Library is a year old, so the threshold is the 60-day ceiling.
  insert.run({
    id: 1,
    path: 'a',
    title: 'Well loved, long quiet',
    added: '-365 days',
    plays: 20,
    loved: 1,
    last: '-120 days',
  })
  insert.run({
    id: 2,
    path: 'b',
    title: 'Played a lot, quiet',
    added: '-365 days',
    plays: 8,
    loved: 0,
    last: '-90 days',
  })
  insert.run({
    id: 3,
    path: 'c',
    title: 'Played recently',
    added: '-365 days',
    plays: 30,
    loved: 1,
    last: '-2 days',
  })
  insert.run({
    id: 4,
    path: 'd',
    title: 'Barely played',
    added: '-365 days',
    plays: 2,
    loved: 0,
    last: '-200 days',
  })
  insert.run({
    id: 5,
    path: 'e',
    title: 'Loved, never played',
    added: '-100 days',
    plays: 0,
    loved: 1,
    last: null,
  })
  insert.run({
    id: 7,
    path: 'g',
    title: 'Just under the line',
    added: '-365 days',
    plays: 9,
    loved: 0,
    last: '-59 days',
  })
  return db
}

describe('gemsThresholdDays', () => {
  it('scales with library age between two weeks and two months', () => {
    expect(gemsThresholdDays(0)).toBe(14)
    expect(gemsThresholdDays(30)).toBe(14)
    expect(gemsThresholdDays(150)).toBe(30)
    expect(gemsThresholdDays(365)).toBe(60)
    expect(gemsThresholdDays(5000)).toBe(60)
  })
})

describe('GemsRepository', () => {
  const repo = new GemsRepository(makeDb())

  it('uses the oldest present song as the library age', () => {
    expect(Math.round(repo.libraryAgeDays())).toBe(365)
    expect(repo.thresholdDays()).toBe(60)
  })

  it('picks loved or well-played songs that have gone quiet, and nothing else', () => {
    const ids = repo
      .pick(60, 20)
      .map(gem => gem.songId)
      .sort((a, b) => a - b)
    // 3 is recent, 4 was never liked, 7 is one day short.
    expect(ids).toEqual([1, 2, 5])
    expect(repo.count(60)).toBe(3)
  })

  it('ranks by plays times days since, within the random nudge', () => {
    // Song 1: 20 × 120 = 2400; song 2: 8 × 90 = 720; song 5: 1 × 100 = 100.
    // The nudge is at most ±25 %, so the order cannot flip.
    const picks = repo.pick(60, 20)
    expect(picks.map(gem => gem.songId)).toEqual([1, 2, 5])
    expect(picks[0]?.daysSince).toBe(120)
    expect(picks[2]?.daysSince).toBe(100)
  })

  it('honours the limit', () => {
    expect(repo.pick(60, 1)).toHaveLength(1)
  })

  it('returns nothing on an empty library', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    const empty = new GemsRepository(db)
    expect(empty.libraryAgeDays()).toBe(0)
    expect(empty.pick(empty.thresholdDays(), 10)).toEqual([])
  })
})
