import path from 'node:path'
import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { migrate } from './migrate.js'

export type Db = Database.Database

/**
 * Open the database and bring the schema up to date.
 *
 * The pragmas matter more than they look:
 *  - WAL lets a long scan write while the API keeps reading.
 *  - `synchronous = NORMAL` is the right trade for a personal library; with WAL
 *    it is durable across application crashes, just not a power cut mid-write.
 *  - `foreign_keys` is off by default in SQLite, which would silently let
 *    orphaned tag links accumulate.
 *  - `busy_timeout` turns "database is locked" into "wait a moment", which is
 *    the difference between a rare hard failure and no failure at all.
 */
export function openDatabase(config: Config, logger: Logger): Db {
  const file = path.join(config.dataDir, 'selfmp3.db')
  const db = new Database(file)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  // ~64 MB of page cache. Trivial on any modern machine, and it keeps the
  // whole index set resident for a library of realistic size.
  db.pragma('cache_size = -64000')

  migrate(db, logger.child('db'))

  logger.debug('database ready', { file })
  return db
}

/**
 * Run `fn` inside a transaction, rolling back if it throws.
 *
 * better-sqlite3's own `transaction()` is synchronous-only, which is exactly
 * what we want — every write path in this server is synchronous by design, so
 * a transaction can never be left open across an await.
 */
export function transact<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}
