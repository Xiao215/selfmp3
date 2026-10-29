import path from 'node:path'
import Database from 'better-sqlite3'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { migrate } from './migrate.js'

export type Db = Database.Database

/** How long a write waits on a lock held elsewhere before it is refused. */
const BUSY_TIMEOUT_MS = 250

/**
 * Open the database and bring the schema up to date.
 *
 * The pragmas matter more than they look:
 *  - WAL lets a long scan write while the API keeps reading.
 *  - `synchronous = NORMAL` is the right trade for a personal library; with WAL
 *    it is durable across application crashes, just not a power cut mid-write.
 *  - `foreign_keys` is off by default in SQLite, which would silently let
 *    orphaned tag links accumulate.
 *  - `busy_timeout` turns "database is locked" into "wait a moment" — but a
 *    short moment (`BUSY_TIMEOUT_MS`). better-sqlite3 waits on the event loop,
 *    so every request waits with it: at 5 s, a lock held from outside (a
 *    `sqlite3` shell left in a transaction) kept /api/health waiting 7-14 s
 *    and every device said the library was unreachable. This server is the
 *    only writer, and the error middleware answers a write still refused with
 *    a 503 the app retries (http/errors.ts `databaseTrouble`).
 */
export function openDatabase(config: Config, logger: Logger): Db {
  const file = path.join(config.dataDir, 'selfmp3.db')
  const db = new Database(file)

  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
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
