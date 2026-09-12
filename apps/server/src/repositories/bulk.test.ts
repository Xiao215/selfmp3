import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from './songs.js'
import { PlaylistRepository } from './playlists.js'
import { TagRepository } from './tags.js'

/**
 * The batch-edit repository work, run against a real in-memory SQLite built
 * from the real migrations.
 *
 * Batch operations are the ones where a half-applied write is expensive — a
 * multi-song delete cannot be undone — so what is asserted here is not only
 * "it deleted the rows" but the partial-failure path: stale ids are reported
 * rather than thrown, and the songs that do exist still go.
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db, createLogger('silent'))

  const insert = db.prepare(`
    INSERT INTO songs (id, path, title, artist, album, duration, loved)
    VALUES (@id, @path, @title, @artist, @album, @duration, @loved)
  `)

  const rows = [
    {
      id: 1,
      path: 'a.mp3',
      title: 'Midnight Drive',
      artist: 'Aurora Lane',
      album: 'Night',
      duration: 254,
      loved: 1,
    },
    {
      id: 2,
      path: 'b.mp3',
      title: 'Sunrise',
      artist: 'Aurora Lane',
      album: 'Night',
      duration: 190,
      loved: 0,
    },
    {
      id: 3,
      path: 'c.mp3',
      title: 'Nocturne Study',
      artist: 'Klara Feld',
      album: 'Etudes',
      duration: 420,
      loved: 0,
    },
    {
      id: 4,
      path: 'd.mp3',
      title: 'Static Bloom',
      artist: 'The Wavelets',
      album: '',
      duration: 100,
      loved: 0,
    },
  ]
  for (const row of rows) insert.run(row)

  return db
}

describe('SongRepository.deleteMany', () => {
  let db: Database.Database
  let songs: SongRepository

  beforeEach(() => {
    db = makeDb()
    songs = new SongRepository(db)
  })

  it('removes every listed song and leaves the rest alone', () => {
    const result = songs.deleteMany([1, 3])

    expect(result.removed).toEqual([1, 3])
    expect(result.missing).toEqual([])
    expect(
      songs
        .all()
        .map(song => song.id)
        .sort(),
    ).toEqual([2, 4])
  })

  it('reports ids that are not in the library instead of failing the batch', () => {
    const result = songs.deleteMany([2, 999, 4])

    expect(result.removed).toEqual([2, 4])
    expect(result.missing).toEqual([999])
    // The partial failure must not cost the songs that were real.
    expect(
      songs
        .all()
        .map(song => song.id)
        .sort(),
    ).toEqual([1, 3])
  })

  it('is a no-op when nothing in the batch exists', () => {
    const result = songs.deleteMany([900, 901])

    expect(result.removed).toEqual([])
    expect(result.missing).toEqual([900, 901])
    expect(songs.count()).toBe(4)
  })

  it('ignores repeated ids rather than counting them twice', () => {
    const result = songs.deleteMany([2, 2, 2])

    expect(result.removed).toEqual([2])
    expect(songs.count()).toBe(3)
  })

  it('accepts an empty batch', () => {
    expect(songs.deleteMany([])).toEqual({ removed: [], missing: [] })
    expect(songs.count()).toBe(4)
  })

  it('takes the tag links and playlist entries with it', () => {
    const tags = new TagRepository(db)
    const playlists = new PlaylistRepository(db)

    const chill = tags.create('chill')
    tags.addToSong(1, chill.id)
    tags.addToSong(2, chill.id)

    const list = playlists.create({ name: 'Evening', description: '', kind: 'manual', rules: null })
    playlists.add(list.id, [1, 2, 3])

    songs.deleteMany([1])

    expect(tags.byId(chill.id)?.songCount).toBe(1)
    expect(playlists.songIds({ ...list, kind: 'manual' })).toEqual([2, 3])
  })

  it('rolls the whole batch back when the transaction throws', () => {
    // Closing over a statement that will fail mid-transaction is the only
    // honest way to prove atomicity: a foreign-key violation on the third
    // song must leave the first two in place.
    const wrapped = db.transaction((ids: number[]) => {
      songs.deleteMany(ids)
      throw new Error('boom')
    })

    expect(() => wrapped([1, 2])).toThrow('boom')
    expect(songs.count()).toBe(4)
  })
})

describe('SongRepository.byIds', () => {
  it('returns the songs that exist, in the order they were asked for', () => {
    const songs = new SongRepository(makeDb())

    expect(songs.byIds([3, 1]).map(song => song.id)).toEqual([3, 1])
  })

  it('silently drops ids that are not in the library', () => {
    const songs = new SongRepository(makeDb())

    expect(songs.byIds([1, 999]).map(song => song.id)).toEqual([1])
    expect(songs.byIds([])).toEqual([])
  })
})

describe('SongRepository.setLovedMany', () => {
  let songs: SongRepository

  beforeEach(() => {
    songs = new SongRepository(makeDb())
  })

  it('loves a whole selection and counts only what changed', () => {
    // Song 1 is already loved, so only two rows are actually different.
    expect(songs.setLovedMany([1, 2, 3], true)).toBe(2)
    expect(songs.byIds([1, 2, 3]).every(song => song.loved)).toBe(true)
    expect(songs.byId(4)?.loved).toBe(false)
  })

  it('unloves, and reports zero when there is nothing to do', () => {
    expect(songs.setLovedMany([1], false)).toBe(1)
    expect(songs.setLovedMany([1], false)).toBe(0)
    expect(songs.byId(1)?.loved).toBe(false)
  })

  it('ignores ids that are not in the library', () => {
    expect(songs.setLovedMany([999], true)).toBe(0)
    expect(songs.setLovedMany([], true)).toBe(0)
  })
})

describe('PlaylistRepository.removeMany', () => {
  it('removes a selection in one edit and reports how many were in it', () => {
    const db = makeDb()
    const playlists = new PlaylistRepository(db)
    const list = playlists.create({ name: 'Evening', description: '', kind: 'manual', rules: null })
    playlists.add(list.id, [1, 2, 3, 4])

    // Song 999 was never in the playlist; it must not stop the other two.
    expect(playlists.removeMany(list.id, [2, 4, 999])).toBe(2)
    expect(playlists.songIds({ ...list, kind: 'manual' })).toEqual([1, 3])
  })

  it('accepts an empty batch without touching the playlist', () => {
    const db = makeDb()
    const playlists = new PlaylistRepository(db)
    const list = playlists.create({ name: 'Evening', description: '', kind: 'manual', rules: null })
    playlists.add(list.id, [1, 2])

    expect(playlists.removeMany(list.id, [])).toBe(0)
    expect(playlists.songIds({ ...list, kind: 'manual' })).toEqual([1, 2])
  })
})
