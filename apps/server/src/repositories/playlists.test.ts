import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
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
