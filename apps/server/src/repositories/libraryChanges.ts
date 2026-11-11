import type { Db } from '../db/index.js'

/**
 * Tables written on their own clock, which nothing the library answer or a
 * live playlist reads comes from: a device saying it is still there (every
 * 10 s from each one online), the pace kept with YouTube, and the sync's
 * bookkeeping of the bucket's files and of how far it has read each device's
 * log. A write to one of them leaves the library as it was.
 */
const ASIDE = new Set(['devices', 'yt_throttle', 'cloud_files', 'cloud_log_cursors'])

/**
 * Whether the library has changed: the same answer while nothing it is read
 * from has been written, a new one after any such write. What a cache built
 * from the library is keyed on, so it is built again only when what it was
 * built from may differ.
 *
 * A count of the writes to every table but those `ASIDE`, kept by triggers on
 * this connection (`TEMP`: they live as long as it does, are made again on
 * each open, and outlast a migration that builds a table again). The
 * database's own count of changes would not do: it moves with every heartbeat,
 * and a phone online emptied every cache each time. Every table but a few,
 * rather than the few the answer reads, so a table read later cannot be
 * missed: one left out of `ASIDE` costs a build, one wrongly in it a stale
 * answer.
 *
 * This connection is the only one that writes: the server opens its database
 * once for each library (`openDatabase`), and the backup only reads it.
 * `data_version` moves when some other connection commits, which is a person
 * at a `sqlite3` shell (db/index.ts), whose write no trigger here sees.
 */
export function libraryChanges(db: Db): () => string {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS library_changes (n INTEGER NOT NULL);
    INSERT INTO library_changes (n) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM library_changes);
  `)
  const tables = db
    .prepare<[], string>(
      `SELECT name FROM pragma_table_list
        WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
    )
    .pluck()
    .all()
  for (const table of tables.filter(name => !ASIDE.has(name))) {
    for (const write of ['INSERT', 'UPDATE', 'DELETE']) {
      db.exec(`
        CREATE TEMP TRIGGER IF NOT EXISTS "library_changes_${table}_${write.toLowerCase()}"
        AFTER ${write} ON main."${table}"
        BEGIN UPDATE library_changes SET n = n + 1; END
      `)
    }
  }
  const read = db.prepare<[], { writes: number; others: number }>(
    `SELECT (SELECT n FROM temp.library_changes) AS writes,
            (SELECT data_version FROM pragma_data_version) AS others`,
  )
  return () => {
    const changed = read.get()
    return `${changed?.writes ?? 0}:${changed?.others ?? 0}`
  }
}
