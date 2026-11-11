import type { Db } from '../db/index.js'

/**
 * Whether the database has changed: the same answer while nothing has been
 * written to it, a new one after any write. What a cache built from it is
 * keyed on, so it is built again only when what it was built from may differ.
 *
 * `total_changes()` counts the rows this connection has changed. It is the
 * only connection that writes: the server opens its database once for each
 * library (`openDatabase`), and the backup only reads it. `data_version`
 * moves when some other connection commits, which is a person at a `sqlite3`
 * shell (db/index.ts).
 */
export function libraryChanges(db: Db): () => string {
  const read = db.prepare<[], { writes: number; others: number }>(
    'SELECT total_changes() AS writes, (SELECT data_version FROM pragma_data_version) AS others',
  )
  return () => {
    const changed = read.get()
    return `${changed?.writes ?? 0}:${changed?.others ?? 0}`
  }
}
