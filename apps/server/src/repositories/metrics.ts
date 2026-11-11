import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

/**
 * The counts behind the owner's admin page (services/metrics.ts says what is
 * counted and why), in a database of their own beside hub.json, `metrics.db`,
 * shared by every library on this server:
 *
 *   import_log    one row per import that finished, worked or failed: where
 *                 from, how long each step took, and why it failed. No
 *                 library, no address, no song.
 *   daily_totals  a count per day and name.
 *
 * Not the library's database, so not its migrations: the two tables are made
 * here when missing.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS import_log (
    id           INTEGER PRIMARY KEY,
    day          TEXT    NOT NULL,
    finished_at  TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    worked       INTEGER NOT NULL CHECK (worked IN (0, 1)),
    failure      TEXT,
    total_ms     INTEGER NOT NULL,
    steps        TEXT    NOT NULL,
    attempts     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_import_log_day ON import_log(day);
  CREATE TABLE IF NOT EXISTS daily_totals (
    day    TEXT    NOT NULL,
    name   TEXT    NOT NULL,
    count  INTEGER NOT NULL,
    PRIMARY KEY (day, name)
  ) WITHOUT ROWID;
`

export interface ImportLogRow {
  readonly day: string
  readonly source: string
  readonly worked: number
  readonly failure: string | null
  readonly total_ms: number
  /** The step times, as JSON. */
  readonly steps: string
  readonly attempts: number
}

interface DailyTotalRow {
  readonly day: string
  readonly name: string
  readonly count: number
}

export class MetricsRepository {
  readonly #db: Database.Database
  readonly #insertImport
  readonly #importsBetween
  readonly #importCountsBetween
  readonly #addTotal
  readonly #totalsBetween
  readonly #pruneImports
  readonly #pruneTotals

  /** `dir`: the server's data folder; `null` keeps everything in memory (tests). */
  constructor(dir: string | null) {
    if (dir !== null) fs.mkdirSync(dir, { recursive: true })
    // A count is not worth holding every request for: better-sqlite3 would
    // wait up to 5 s on the event loop for a lock held elsewhere.
    this.#db = new Database(dir === null ? ':memory:' : path.join(dir, 'metrics.db'), {
      timeout: 250,
    })
    this.#db.pragma('journal_mode = WAL')
    this.#db.exec(SCHEMA)
    this.#insertImport = this.#db.prepare<[ImportLogRow & { finished_at: string }]>(
      `INSERT INTO import_log (day, finished_at, source, worked, failure, total_ms, steps, attempts)
       VALUES (@day, @finished_at, @source, @worked, @failure, @total_ms, @steps, @attempts)`,
    )
    this.#importsBetween = this.#db.prepare<[string, string], ImportLogRow>(
      `SELECT day, source, worked, failure, total_ms, steps, attempts
       FROM import_log WHERE day >= ? AND day <= ? ORDER BY day`,
    )
    this.#importCountsBetween = this.#db.prepare<
      [string, string],
      { done: number | null; failed: number | null }
    >(
      `SELECT SUM(worked) AS done, SUM(1 - worked) AS failed
       FROM import_log WHERE day >= ? AND day < ?`,
    )
    this.#addTotal = this.#db.prepare<[string, string, number]>(
      `INSERT INTO daily_totals (day, name, count) VALUES (?, ?, ?)
       ON CONFLICT (day, name) DO UPDATE SET count = count + excluded.count`,
    )
    this.#totalsBetween = this.#db.prepare<[string, string], DailyTotalRow>(
      `SELECT day, name, count FROM daily_totals WHERE day >= ? AND day <= ?`,
    )
    this.#pruneImports = this.#db.prepare<[string]>('DELETE FROM import_log WHERE day < ?')
    this.#pruneTotals = this.#db.prepare<[string]>('DELETE FROM daily_totals WHERE day < ?')
  }

  insertImport(row: ImportLogRow & { readonly finished_at: string }): void {
    this.#insertImport.run(row)
  }

  /** Imports finished from `from` to `to`, both days included, oldest first. */
  importsBetween(from: string, to: string): ImportLogRow[] {
    return this.#importsBetween.all(from, to)
  }

  /** How many imports worked and failed from `from` up to, not including, `before`. */
  importCountsBetween(from: string, before: string): { done: number; failed: number } {
    const row = this.#importCountsBetween.get(from, before)
    return { done: row?.done ?? 0, failed: row?.failed ?? 0 }
  }

  /** Add to a day's totals, several names at once, in one transaction. */
  addTotals(day: string, counts: Readonly<Record<string, number>>): void {
    this.#db.transaction(() => {
      for (const [name, by] of Object.entries(counts)) if (by > 0) this.#addTotal.run(day, name, by)
    })()
  }

  /** Every total from `from` to `to`, both days included. */
  totalsBetween(from: string, to: string): DailyTotalRow[] {
    return this.#totalsBetween.all(from, to)
  }

  /** Forget every row from before `day`. */
  pruneBefore(day: string): void {
    this.#pruneImports.run(day)
    this.#pruneTotals.run(day)
  }

  close(): void {
    this.#db.close()
  }
}
