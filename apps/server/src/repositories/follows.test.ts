import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { PlaylistRepository } from './playlists.js'
import { TagRepository } from './tags.js'

/**
 * A playlist that follows tags, and what happens when it stops.
 *
 * Run against a real in-memory SQLite built from the real migrations, because
 * the thing worth proving is not that a column changed but that the songs
 * survive the change. A live playlist's songs are the answer to its rules and
 * are stored nowhere; switching the kind without writing them down first would
 * quietly empty a playlist someone had been building for a year.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, createLogger('silent'))

  const insert = db.prepare(`
    INSERT INTO songs (id, path, title, artist, album, duration, missing)
    VALUES (@id, @path, @title, @artist, @album, @duration, @missing)
  `)
  const rows = [
    { id: 1, path: 'a.mp3', title: '夜曲', artist: '周杰倫', album: '', duration: 217, missing: 0 },
    {
      id: 2,
      path: 'b.mp3',
      title: '小情歌',
      artist: '蘇打綠',
      album: '',
      duration: 281,
      missing: 0,
    },
    {
      id: 3,
      path: 'c.mp3',
      title: 'Weightless',
      artist: 'Marconi',
      album: '',
      duration: 489,
      missing: 0,
    },
    // On another device's disk, not this one's: it is still in the library.
    { id: 4, path: 'd.mp3', title: 'Gone', artist: 'Nobody', album: '', duration: 100, missing: 1 },
  ]
  for (const row of rows) insert.run(row)
  return db
}

describe('a playlist that follows tags', () => {
  let db: Database.Database
  let playlists: PlaylistRepository
  let tags: TagRepository
  let chill: number
  let chinese: number

  beforeEach(() => {
    db = makeDb()
    playlists = new PlaylistRepository(db)
    tags = new TagRepository(db)
    chill = tags.create('chill').id
    chinese = tags.create('中文').id
    tags.addToSong(1, chill)
    tags.addToSong(1, chinese)
    tags.addToSong(2, chinese)
    tags.addToSong(3, chill)
    tags.addToSong(4, chill)
  })

  const following = (tagIds: readonly number[]) =>
    playlists.create({
      name: 'chill · 中文',
      description: '',
      kind: 'live',
      rules: {
        match: 'any',
        rules: tagIds.map(tagId => ({ field: 'tag' as const, op: 'has' as const, tagId })),
        orderBy: 'title',
        order: 'asc',
        limit: null,
      },
    })

  it('holds every song carrying any of its tags, not only songs carrying all', () => {
    const playlist = following([chill, chinese])
    // 1 has both, 2 is chinese, 3 is chill. All three.
    expect(playlists.songIds(playlist).sort()).toEqual([1, 2, 3])
  })

  it('takes in a song the moment it is tagged', () => {
    const playlist = following([chinese])
    expect(playlists.songIds(playlist).sort()).toEqual([1, 2])
    tags.addToSong(3, chinese)
    expect(playlists.songIds(playlists.byId(playlist.id)!).sort()).toEqual([1, 2, 3])
  })

  it('keeps every song when it stops following, and stops taking new ones', () => {
    const playlist = following([chinese])
    const before = playlists.songIds(playlist)
    expect(before.sort()).toEqual([1, 2])

    playlists.stopFollowing(playlist)

    const after = playlists.byId(playlist.id)
    expect(after?.kind).toBe('manual')
    expect(after?.rules).toBeNull()
    expect(playlists.songIds(after!).sort()).toEqual([1, 2])

    // Tagging another song no longer reaches it: that is the whole point.
    tags.addToSong(3, chinese)
    expect(playlists.songIds(playlists.byId(playlist.id)!).sort()).toEqual([1, 2])
  })

  it('keeps a song whose file is missing from this disk', () => {
    const playlist = following([chill])
    // The player's view leaves out song 4; the playlist must not.
    expect(playlists.songIds(playlist)).not.toContain(4)
    expect(playlists.snapshotSongIds(playlist)).toContain(4)

    playlists.stopFollowing(playlist)
    expect(playlists.snapshotSongIds(playlists.byId(playlist.id)!)).toContain(4)
  })

  it('keeps the order the rules had put them in', () => {
    const playlist = following([chill, chinese])
    const ordered = playlists.snapshotSongIds(playlist)
    playlists.stopFollowing(playlist)
    expect(playlists.snapshotSongIds(playlists.byId(playlist.id)!)).toEqual(ordered)
  })

  it('does nothing to a playlist that was not following anything', () => {
    const plain = playlists.create({ name: 'Gym', description: '', kind: 'manual', rules: null })
    playlists.add(plain.id, [3, 1])
    playlists.stopFollowing(plain)
    expect(playlists.byId(plain.id)?.kind).toBe('manual')
    expect(playlists.songIds(playlists.byId(plain.id)!)).toEqual([3, 1])
  })
})
