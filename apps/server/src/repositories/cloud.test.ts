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
 * Stable ids.
 *
 * Every song, tag and playlist gets a uid however it was inserted. The uid is
 * filled in by a trigger that updates the row straight after the insert, so
 * the database is checked for integrity through inserts, renames and plays,
 * not just for the uids it hands out.
 */

const UID = /^[0-9a-f]{32}$/

describe('uids', () => {
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

  it('stays sound through inserts, renames and plays', () => {
    const id = insert('Sunrise')
    insert('Nocturne Study in E', 'Kaito Mori')
    songs.patch(id, { title: 'Daybreak' })
    new StatsRepository(db).record(id, 120_000, true, null, null)
    songs.recordPlay(id)
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('keeps no title index: nothing searches songs by title on the server', () => {
    const named = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE name LIKE 'songs_fts%'")
      .all()
    expect(named).toEqual([])
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

describe('the trash', () => {
  let db: Database.Database
  let cloud: CloudRepository
  let songId: number

  const key = (folder: string, fill: string, ext = 'jpg'): string =>
    `${folder}/${fill.repeat(64)}.${ext}`

  const state = (cover: string | null, lyrics: string | null = null) => ({
    songId,
    audioKey: key('audio', 'a', 'm4a'),
    audioSize: 100,
    audioSig: 'audio',
    coverKey: cover,
    coverSize: cover ? 10 : null,
    coverSig: cover ?? 'none',
    lyricsKey: lyrics,
    lyricsSize: lyrics ? 5 : null,
    lyricsKind: lyrics ? ('plain' as const) : null,
    romanizedKey: null,
    lyricsSig: lyrics ?? 'none',
    motionKey: null,
    motionSig: 'none',
  })

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db, createLogger('silent'))
    cloud = new CloudRepository(db)
    songId = Number(
      db.prepare("INSERT INTO songs (path, title) VALUES ('a.m4a', 'A')").run().lastInsertRowid,
    )
  })

  it('takes a cover or words a song no longer names, and nothing it still does', () => {
    cloud.recordFile(key('covers', 'b'), 10)
    cloud.saveState(state(key('covers', 'b'), key('lyrics', 'c', 'txt')))

    // The cover made again (squared): a new hash, the old file nameless.
    cloud.saveState(state(key('covers', 'd'), key('lyrics', 'c', 'txt')))

    expect(cloud.trashedKeys()).toEqual([key('covers', 'b')])
  })

  it('never offers a file another song still names', () => {
    const other = Number(
      db.prepare("INSERT INTO songs (path, title) VALUES ('b.m4a', 'B')").run().lastInsertRowid,
    )
    cloud.saveState(state(key('covers', 'b')))
    cloud.saveState({ ...state(key('covers', 'b')), songId: other })

    cloud.saveState(state(key('covers', 'd')))

    // Same album art on two songs: one moving on leaves the other's alone.
    expect(cloud.trashedKeys()).toEqual([])
  })

  it('takes every cover nothing names, and only covers', () => {
    cloud.saveState(state(key('covers', 'b')))
    for (const listed of [
      key('covers', 'b'),
      key('covers', 'e'),
      key('audio', 'f', 'm4a'),
      key('lyrics', '9', 'txt'),
    ]) {
      cloud.recordFile(listed, 1)
    }

    expect(cloud.trashUnnamedCovers()).toBe(1)
    // Audio and words no row names may be the only copy of a song whose row went.
    expect(cloud.trashedKeys()).toEqual([key('covers', 'e')])
  })

  it('keeps an artist’s picture while it is named, and trashes it once replaced or gone', () => {
    const picture = {
      artist: 'yorushika',
      bannerKey: key('covers', '1'),
      bannerSize: 10,
      portraitKey: key('covers', '2'),
      portraitSize: 5,
      sig: 'r1',
    }
    cloud.recordFile(picture.bannerKey, 10)
    cloud.recordFile(picture.portraitKey, 5)
    cloud.saveArtist(picture)
    expect(cloud.trashUnnamedCovers()).toBe(0)

    cloud.saveArtist({ ...picture, bannerKey: key('covers', '3'), sig: 'r2' })
    expect(cloud.trashedKeys()).toEqual([key('covers', '1')])

    cloud.dropArtist('yorushika')
    expect(cloud.trashedKeys()).toEqual([
      key('covers', '1'),
      key('covers', '2'),
      key('covers', '3'),
    ])
    expect(cloud.artistStates().size).toBe(0)
  })
})
