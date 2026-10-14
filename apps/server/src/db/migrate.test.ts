import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { migrate } from './migrate.js'

const count = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('migrate', () => {
  it('gives every song, tag and playlist a uid as it is made, and never none', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))

    const song = db.prepare("INSERT INTO songs (path, title) VALUES ('a.m4a', 'A')").run()
    const tag = db.prepare("INSERT INTO tags (name) VALUES ('Rain')").run()
    const playlist = db.prepare("INSERT INTO playlists (name) VALUES ('Mine')").run()
    for (const [table, id] of [
      ['songs', song.lastInsertRowid],
      ['tags', tag.lastInsertRowid],
      ['playlists', playlist.lastInsertRowid],
    ] as const) {
      const row = db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(id) as { uid: string }
      expect(row.uid).toMatch(/^[0-9a-f]{32}$/)
    }
    expect(() => db.prepare("INSERT INTO tags (name, uid) VALUES ('Sun', NULL)").run()).toThrow(
      /NOT NULL/,
    )
  })

  /*
   * The uid migration makes songs, tags and playlists again. With foreign keys
   * on, dropping the old tables would delete every tag link, play and
   * playlist entry by cascade; the runner turns them off around it.
   */
  it('keeps what points at a table it makes again', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    db.exec(`
      INSERT INTO songs (id, path, title) VALUES (1, 'a.m4a', 'A'), (2, 'b.m4a', 'B');
      INSERT INTO tags (id, name) VALUES (1, 'Rain');
      INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1), (2, 1);
      INSERT INTO playlists (id, name) VALUES (1, 'Mine');
      INSERT INTO playlist_items (playlist_id, song_id, position) VALUES (1, 2, 0);
    `)
    const uids = db.prepare('SELECT uid FROM songs ORDER BY id').all()
    const latest = db.pragma('user_version', { simple: true }) as number

    // Run the uid migration (35) again over the rows above, and the ones after
    // it, whose tables go first so they can be made again.
    db.exec(
      'DROP TABLE cloud_artists; DROP TABLE cloud_sound; DROP TABLE bucket_downloads; DROP TABLE cloud_plays',
    )
    db.pragma('user_version = 34')
    migrate(db, createLogger('silent'))

    expect(db.pragma('user_version', { simple: true })).toBe(latest)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(count(db, 'song_tags')).toBe(2)
    expect(count(db, 'playlist_items')).toBe(1)
    expect(db.prepare('SELECT uid FROM songs ORDER BY id').all()).toEqual(uids)
    expect(db.pragma('foreign_key_check')).toEqual([])

    // And the cascade still works afterwards.
    db.prepare('DELETE FROM songs WHERE id = 2').run()
    expect(count(db, 'song_tags')).toBe(1)
    expect(count(db, 'playlist_items')).toBe(0)
  })

  /*
   * A live playlist names its tags by id here. Given out again, the id of a
   * deleted tag made the playlist follow whichever tag was made next.
   */
  it('never gives a tag’s id out twice, nor one a rule or an import still names', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    const latest = db.pragma('user_version', { simple: true }) as number
    const tagRule = (tagId: number) =>
      JSON.stringify({ match: 'all', rules: [{ field: 'tag', op: 'has', tagId }] })
    // Tags as they were before 41, with ids that could be handed out again;
    // tag 7 is gone but a playlist's rule still names it, and 9 an import's.
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE tags;
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        hue INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        uid TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
      );
      PRAGMA foreign_keys = ON;
      INSERT INTO songs (id, path, title) VALUES (1, 'a.m4a', 'A');
      INSERT INTO tags (id, name) VALUES (1, 'Rain'), (3, 'Sun');
      INSERT INTO song_tags (song_id, tag_id) VALUES (1, 3);
      INSERT INTO playlists (name, kind, rules) VALUES ('Gone', 'live', '${tagRule(7)}');
      INSERT INTO playlists (name, kind, rules) VALUES ('Broken', 'live', 'not json');
      INSERT INTO import_jobs (id, url, tag_ids) VALUES ('j', 'u', '[1, 9]');
      -- And the import queue as it was before 42 added what a device holds.
      DROP INDEX idx_import_jobs_lease;
      ALTER TABLE import_jobs DROP COLUMN fetcher;
      ALTER TABLE import_jobs DROP COLUMN lease_id;
      ALTER TABLE import_jobs DROP COLUMN lease_until;
    `)
    db.pragma('user_version = 40')
    migrate(db, createLogger('silent'))

    expect(db.pragma('user_version', { simple: true })).toBe(latest)
    expect(count(db, 'song_tags')).toBe(1)
    const made = (name: string) =>
      Number(db.prepare('INSERT INTO tags (name) VALUES (?)').run(name).lastInsertRowid)
    expect(made('Snow')).toBe(10)
    // The newest deleted, and the next made: a new id, not the one just freed.
    db.prepare('DELETE FROM tags WHERE id = 10').run()
    expect(made('Hail')).toBe(11)
  })

  it('gives an import job named by another build the queue’s own words, and holds it to them', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    const latest = db.pragma('user_version', { simple: true }) as number
    // The table as it was before 39, which named nothing.
    db.exec(`
      DROP TABLE import_jobs;
      CREATE TABLE import_jobs (
        id TEXT PRIMARY KEY, url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        step TEXT NOT NULL DEFAULT 'waiting', progress REAL, title TEXT NOT NULL DEFAULT '',
        artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', thumbnail TEXT,
        duration REAL NOT NULL DEFAULT 0, error TEXT, song_id INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
        tag_ids TEXT NOT NULL DEFAULT '[]', playlist_id INTEGER, position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), request_uid TEXT
      );
      INSERT INTO import_jobs (id, url, status, step) VALUES
        ('a', 'u', 'failed', 'fetching'),
        ('b', 'u', 'done', 'tagging'),
        ('c', 'u', 'queued', 'waiting');
    `)
    // 39 again, and what came after it, whose tables go first.
    db.exec('DROP TABLE cloud_plays')
    db.pragma('user_version = 38')
    migrate(db, createLogger('silent'))

    expect(db.pragma('user_version', { simple: true })).toBe(latest)
    expect(db.prepare('SELECT id, status, step FROM import_jobs ORDER BY id').all()).toEqual([
      { id: 'a', status: 'error', step: 'waiting' },
      { id: 'b', status: 'done', step: 'finished' },
      { id: 'c', status: 'queued', step: 'waiting' },
    ])
    expect(() =>
      db.prepare("INSERT INTO import_jobs (id, url, status) VALUES ('d', 'u', 'paused')").run(),
    ).toThrow(/CHECK/)
  })

  it('drops the rows of settings no longer kept, and keeps the rest', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.exec(`
      INSERT INTO settings (key, value) VALUES
        ('autoScanMinutes', '5'), ('crossfadeSeconds', '6'), ('gapless', 'true'),
        ('theme', '"dark"'), ('watchLibrary', 'false'), ('smartWeb', 'true');
    `)
    db.pragma('user_version = 41')
    migrate(db, createLogger('silent'))

    const keys = db.prepare('SELECT key FROM settings ORDER BY key').pluck().all()
    expect(keys).toEqual(['smartWeb', 'watchLibrary'])
  })
})
