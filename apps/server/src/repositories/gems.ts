import { gemsThresholdDays } from '@selfmp3/shared'
import type { Db } from '../db/index.js'

/**
 * Forgotten gems: songs you clearly liked that have gone quiet.
 *
 * A song qualifies when it is loved or has five or more plays, its file is
 * present, and it has not been played for at least the threshold (a loved
 * song never played counts from the day it was added). Ranking is
 * `plays × days since`, nudged by a random factor between 0.75 and 1.25 so the
 * same handful does not sit at the top forever.
 */

/** Below this a song was only ever passing through. */
const MIN_PLAYS = 5

interface GemRow {
  readonly songId: number
  readonly daysSince: number
  readonly score: number
}

export class GemsRepository {
  readonly #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Days since the first song was added — how old the library is. */
  libraryAgeDays(): number {
    const row = this.#db
      .prepare<[], { age: number | null }>(
        "SELECT julianday('now') - MIN(julianday(added_at)) AS age FROM songs WHERE missing = 0",
      )
      .get()
    return Math.max(0, row?.age ?? 0)
  }

  thresholdDays(): number {
    return gemsThresholdDays(this.libraryAgeDays())
  }

  count(minDays: number): number {
    const row = this.#db
      .prepare<[number, number], { count: number }>(
        `SELECT COUNT(*) AS count FROM songs
          WHERE missing = 0
            AND (loved = 1 OR play_count >= ?)
            AND julianday('now') - julianday(COALESCE(last_played_at, added_at)) >= ?`,
      )
      .get(MIN_PLAYS, minDays)
    return row?.count ?? 0
  }

  pick(minDays: number, limit: number): GemRow[] {
    return this.#db
      .prepare<[number, number, number], { id: number; days_since: number; score: number }>(
        `SELECT id,
                julianday('now') - julianday(COALESCE(last_played_at, added_at)) AS days_since,
                MAX(play_count, 1)
                  * (julianday('now') - julianday(COALESCE(last_played_at, added_at)))
                  * (0.75 + (abs(random()) % 1000) / 2000.0) AS score
           FROM songs
          WHERE missing = 0
            AND (loved = 1 OR play_count >= ?)
            AND julianday('now') - julianday(COALESCE(last_played_at, added_at)) >= ?
          ORDER BY score DESC
          LIMIT ?`,
      )
      .all(MIN_PLAYS, minDays, limit)
      .map(row => ({
        songId: row.id,
        daysSince: Math.floor(row.days_since),
        score: row.score,
      }))
  }
}
