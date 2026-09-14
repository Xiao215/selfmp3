import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, migrationVersion } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from './playlists.js'

/**
 * What a playlist does around a song whose file is not there.
 *
 * Playing a playlist skips those songs, which is right — there is nothing to
 * play. Rewriting one must not, because `add` at a position and `reorder` both
 * clear the playlist and write back what they read: read the playing view and
 * every missing song is gone for good, over an unplugged drive.
 */

describe('a playlist holding a song whose file is missing', () => {
  let db: Database.Database
  let playlists: PlaylistRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.exec(`
      INSERT INTO songs (id, path, title) VALUES
        (1, 'a.m4a', 'A'), (2, 'b.m4a', 'B'), (3, 'c.m4a', 'C');
      UPDATE songs SET missing = 1 WHERE id = 2;
    `)
    playlists = new PlaylistRepository(db)
    playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null })
    playlists.add(1, [1, 2, 3])
  })

  const everyRow = (): number[] =>
    db
      .prepare<[], { song_id: number }>(
        'SELECT song_id FROM playlist_items WHERE playlist_id = 1 ORDER BY position, rowid',
      )
      .all()
      .map(row => row.song_id)

  it('leaves it out of what plays', () => {
    const playlist = playlists.byId(1)
    expect(playlist).not.toBeNull()
    expect(playlists.songIds(playlist!)).toEqual([1, 3])
  })

  it('keeps it through a reorder', () => {
    playlists.reorder(1, [3, 1])
    expect(everyRow()).toContain(2)
  })

  it('keeps it when a song is inserted partway down', () => {
    db.exec("INSERT INTO songs (id, path, title) VALUES (4, 'd.m4a', 'D');")
    playlists.add(1, [4], 1)
    expect(everyRow()).toContain(2)
  })

  it('comes back to the playlist once the file is found again', () => {
    playlists.reorder(1, [3, 1])
    db.exec('UPDATE songs SET missing = 0 WHERE id = 2')
    const playlist = playlists.byId(1)
    expect(playlists.songIds(playlist!).sort()).toEqual([1, 2, 3])
  })
})

describe('the migration that renames smart playlists to live ones', () => {
  it('keeps every playlist, its songs and its uid, and calls the rules kind live', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const logger = createLogger('silent')
    const migration = migrationVersion('playlists: live instead of smart, and when each was last played')
    migrate(db, logger, migration - 1)
    db.exec(`
      INSERT INTO songs (id, path, title) VALUES (1, 'a.m4a', 'A'), (2, 'b.m4a', 'B');
      INSERT INTO playlists (id, name, kind, rules, uid) VALUES
        (1, 'Mix', 'manual', NULL, 'mix'),
        (2, 'Long', 'smart', '{"match":"all","rules":[],"orderBy":"addedAt","order":"desc","limit":null}', 'long');
      INSERT INTO playlist_items (playlist_id, song_id, position) VALUES (1, 2, 0), (1, 1, 1);
    `)

    migrate(db, logger)

    const playlists = new PlaylistRepository(db)
    expect(playlists.byId(1)).toMatchObject({ kind: 'manual', lastPlayedAt: null })
    expect(playlists.byId(2)?.kind).toBe('live')
    // Dropping the old table must not have cascaded the songs away.
    expect(playlists.songIds(playlists.byId(1)!)).toEqual([2, 1])
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    // The uid trigger came back with the table.
    playlists.create({ name: 'New', description: '', kind: 'manual', rules: null })
    const uid = db.prepare<[], { uid: string | null }>("SELECT uid FROM playlists WHERE name = 'New'").get()
    expect(uid?.uid).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('a playlist being played', () => {
  let db: Database.Database
  let playlists: PlaylistRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    playlists = new PlaylistRepository(db)
    playlists.create({ name: 'Mix', description: '', kind: 'manual', rules: null })
    db.exec("UPDATE playlists SET updated_at = '2020-01-01 00:00:00' WHERE id = 1")
  })

  it('has never been played when it is new', () => {
    expect(playlists.byId(1)?.lastPlayedAt).toBeNull()
  })

  it('says when it was played, without counting the play as an edit', () => {
    playlists.markPlayed(1)
    const playlist = playlists.byId(1)
    expect(playlist?.lastPlayedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // Sync reads updated_at as "changed"; a play must not look like one.
    expect(playlist?.updatedAt).toBe('2020-01-01 00:00:00')
  })
})
