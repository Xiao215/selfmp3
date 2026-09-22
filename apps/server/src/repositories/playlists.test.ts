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

/**
 * A playlist that follows tags, put in an order by hand.
 *
 * Its songs are the rule's answer, worked out on every read, so an order set
 * by hand has to be kept somewhere and laid over that answer: the songs you
 * placed come first, in your order, and whatever the rule has matched since
 * follows. It keeps following either way (Xiao, 2026-09-21).
 */
describe('a playlist that follows tags, ordered by hand', () => {
  let db: Database.Database
  let playlists: PlaylistRepository

  const rulesForTag = (tagId: number): Parameters<PlaylistRepository['create']>[0]['rules'] => ({
    match: 'any',
    rules: [{ field: 'tag' as const, op: 'has' as const, tagId }],
    orderBy: 'title',
    order: 'asc',
    limit: null,
  })

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.exec(`
      INSERT INTO songs (id, path, title) VALUES
        (1, 'a.m4a', 'A'), (2, 'b.m4a', 'B'), (3, 'c.m4a', 'C');
      INSERT INTO tags (id, name, hue) VALUES (1, 'chill', 200);
      INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1), (2, 1), (3, 1);
    `)
    playlists = new PlaylistRepository(db)
    playlists.create({ name: 'Chill', description: '', kind: 'live', rules: rulesForTag(1) })
  })

  const ids = (): number[] => playlists.songIds(playlists.byId(1)!)

  it('is in the rule’s order until it is given one', () => {
    expect(ids()).toEqual([1, 2, 3])
  })

  it('keeps the order it is put in', () => {
    playlists.reorder(1, [3, 1, 2])
    expect(ids()).toEqual([3, 1, 2])
  })

  it('still follows: a newly tagged song lands after the order you set', () => {
    playlists.reorder(1, [3, 1, 2])
    db.exec("INSERT INTO songs (id, path, title) VALUES (4, 'd.m4a', 'D');")
    db.exec('INSERT INTO song_tags (song_id, tag_id) VALUES (4, 1);')
    expect(ids()).toEqual([3, 1, 2, 4])
  })

  it('drops a song that stops matching, and puts it back where it was', () => {
    playlists.reorder(1, [3, 1, 2])
    db.exec('DELETE FROM song_tags WHERE song_id = 1')
    expect(ids()).toEqual([3, 2])
    db.exec('INSERT INTO song_tags (song_id, tag_id) VALUES (1, 1);')
    expect(ids()).toEqual([3, 1, 2])
  })
})
