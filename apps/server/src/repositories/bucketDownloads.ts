import type { Db } from '../db/index.js'

/**
 * The songs this server's background work — analysis and the listening
 * model — has downloaded from the bucket on one day (UTC, as Backblaze counts
 * its daily allowance): one row, kept across restarts. Kept in memory it
 * started again at nought on every restart, and the Pi restarts with every
 * update, so the day's limit was a limit per run.
 */
export class BucketDownloadsRepository {
  readonly #read
  readonly #spend

  constructor(db: Db) {
    this.#read = db.prepare<[], { day: string; count: number }>(
      'SELECT day, count FROM bucket_downloads WHERE id = 1',
    )
    this.#spend = db.prepare<[string, string]>(`
      UPDATE bucket_downloads
         SET count = CASE WHEN day = ? THEN count + 1 ELSE 1 END, day = ?
       WHERE id = 1
    `)
  }

  /** How many were made on `day` (`2026-10-07`). */
  spentOn(day: string): number {
    const row = this.#read.get()
    return row?.day === day ? row.count : 0
  }

  /** One more made on `day`. */
  spend(day: string): void {
    this.#spend.run(day, day)
  }
}
