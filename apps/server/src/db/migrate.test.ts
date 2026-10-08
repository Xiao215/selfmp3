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
    db.exec('DROP TABLE cloud_artists')
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
})
