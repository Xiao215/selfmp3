import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { CloudRepository } from './cloud.js'
import { SongRepository } from './songs.js'
import { StatsRepository } from './stats.js'
import { TagRepository } from './tags.js'
import { PlaylistRepository } from './playlists.js'

/**
 * Stable ids, and the search index they must not disturb.
 *
 * Every song, tag and playlist gets a uid however it was inserted. The uid is
 * filled in by a trigger that updates the row straight after the insert —
 * which is exactly the moment the old search-index trigger would have tried
 * to delete an entry that did not exist yet, corrupting the index. So the
 * index is checked for integrity, not just for results.
 */

const UID = /^[0-9a-f]{32}$/

describe('uids and the search index', () => {
  let db: Database.Database
  let songs: SongRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    songs = new SongRepository(db)
  })

  const insert = (title: string, artist = 'Aurora Lane'): number =>
    songs.insert({
      path: `${artist} - ${title}/${artist} - ${title}.m4a`,
      title,
      artist,
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 200,
      sizeBytes: 1000,
      mime: 'audio/mp4',
      mtimeMs: 1,
      hasArt: false,
      artExt: null,
      lyricsKind: 'none',
      sourceUrl: null,
    })

  const uid = (table: string, id: number): unknown =>
    (db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(id) as { uid: unknown }).uid

  const indexIsSound = (): void => {
    expect(() =>
      db.prepare("INSERT INTO songs_fts(songs_fts) VALUES ('integrity-check')").run(),
    ).not.toThrow()
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  }

  it('gives every new song, tag and playlist a uid of its own', () => {
    const one = insert('Sunrise')
    const two = insert('Sunset')
    const tag = new TagRepository(db).create('chill')
    const playlist = new PlaylistRepository(db).create({
      name: 'Mix',
      description: '',
      kind: 'manual',
      rules: null,
    })

    expect(uid('songs', one)).toMatch(UID)
    expect(uid('songs', two)).toMatch(UID)
    expect(uid('songs', one)).not.toBe(uid('songs', two))
    expect(uid('tags', tag.id)).toMatch(UID)
    expect(uid('playlists', playlist.id)).toMatch(UID)
  })

  it('keeps a uid a song arrives with, as one made on another device will', () => {
    const given = 'c'.repeat(32)
    db.prepare("INSERT INTO songs (path, title, uid) VALUES ('x.m4a', 'Elsewhere', ?)").run(given)
    const row = db.prepare("SELECT uid FROM songs WHERE path = 'x.m4a'").get() as { uid: string }
    expect(row.uid).toBe(given)
  })

  it('refuses a second song with the same uid', () => {
    const given = 'd'.repeat(32)
    db.prepare("INSERT INTO songs (path, title, uid) VALUES ('a.m4a', 'A', ?)").run(given)
    expect(() =>
      db.prepare("INSERT INTO songs (path, title, uid) VALUES ('b.m4a', 'B', ?)").run(given),
    ).toThrow(/UNIQUE/)
  })

  it('still finds songs by title, and keeps the index sound through inserts', () => {
    insert('Sunrise')
    insert('Nocturne Study in E', 'Kaito Mori')
    indexIsSound()
    expect(songs.search('nocturne').map(song => song.title)).toEqual(['Nocturne Study in E'])
  })

  it('follows a rename, and a play no longer rewrites the index', () => {
    const id = insert('Sunrise')
    songs.patch(id, { title: 'Daybreak' })
    indexIsSound()
    expect(songs.search('daybreak').map(song => song.id)).toEqual([id])
    expect(songs.search('sunrise')).toEqual([])

    new StatsRepository(db).record(id, 120_000, true, null, null)
    songs.recordPlay(id)
    indexIsSound()
    expect(songs.search('daybreak').map(song => song.id)).toEqual([id])
  })

  it('reads song files with their uids for the sync', () => {
    const id = insert('Sunrise')
    const [file] = new CloudRepository(db).songFiles()
    expect(file).toMatchObject({ id, title: 'Sunrise', uid: uid('songs', id) })
  })
})

describe('the connection', () => {
  let db: Database.Database
  let cloud: CloudRepository

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    cloud = new CloudRepository(db)
  })

  const connection = {
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'my-music',
    prefix: 'selfmp3',
    keyId: 'key',
    applicationKey: 'secret',
  }

  it('is kept apart from settings, and read back whole', () => {
    cloud.saveConnection(connection)
    expect(cloud.connection()).toEqual(connection)
    const settings = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }
    expect(settings.n).toBe(0)
  })

  it('reads a corrupt row as not connected rather than failing', () => {
    db.prepare("INSERT INTO secrets (name, value) VALUES ('cloud.connection', '{oops')").run()
    expect(cloud.connection()).toBeNull()
  })

  it('forgets what was uploaded when pointed at another folder, not for a new key', () => {
    cloud.saveConnection(connection)
    cloud.recordFile(`audio/${'a'.repeat(64)}.m4a`, 10)

    cloud.saveConnection({ ...connection, keyId: 'new-key', applicationKey: 'new-secret' })
    expect(cloud.hasFile(`audio/${'a'.repeat(64)}.m4a`)).toBe(true)

    cloud.saveConnection({ ...connection, prefix: 'elsewhere' })
    expect(cloud.hasFile(`audio/${'a'.repeat(64)}.m4a`)).toBe(false)
  })

  it('names this server once and keeps the name', () => {
    const first = cloud.deviceId()
    // The name starts from the platform, so the prefix depends on where the
    // tests run; a Mac is the one worth naming.
    expect(first).toMatch(
      process.platform === 'darwin' ? /^mac-[0-9a-f]{8}$/ : /^[a-z0-9-]+-[0-9a-f]{8}$/,
    )
    expect(cloud.deviceId()).toBe(first)
  })
})
