import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { CloudRepository } from '../repositories/cloud.js'
import { LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import { SongRepository } from '../repositories/songs.js'
import { TagRepository } from '../repositories/tags.js'
import { LocalStorageDriver } from '../storage/local.js'
import { CoverService } from './covers.js'
import { LyricsCache } from './lyricsCache.js'
import { LyricsIndexService } from './lyricsIndex.js'
import { LyricsService } from './lyrics.js'
import { MetadataService } from './metadata.js'
import { MotionStore } from './motionStore.js'
import { SongRemovalService } from './songRemoval.js'

/**
 * Against a real library folder and data directory, so what is left on disk
 * afterwards is what is checked. Four call sites used to each forget one of
 * the things a song leaves behind; these pin every one of them — including
 * the copy on disk, which always goes: left there, the next sweep would make a
 * new song of it, which is how forty-three removed songs once came back.
 */
describe('SongRemovalService', () => {
  let root: string
  let dataDir: string
  let db: Database.Database
  let songs: SongRepository
  let tags: TagRepository
  let search: LyricsSearchRepository
  let cloud: CloudRepository
  let lyricsCache: LyricsCache
  let covers: CoverService
  let removal: SongRemovalService
  let changes = 0

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-removal-'))
    dataDir = path.join(root, 'data')
    db = new Database(':memory:')
    const logger = createLogger('silent')
    migrate(db, logger)
    songs = new SongRepository(db)
    tags = new TagRepository(db)
    search = new LyricsSearchRepository(db)
    cloud = new CloudRepository(db)
    const storage = new LocalStorageDriver(path.join(root, 'library'))
    const lyrics = new LyricsService(storage, logger, () => Promise.reject(new Error('offline')))
    const config = { dataDir } as Config
    covers = new CoverService(config, songs, logger)
    lyricsCache = new LyricsCache(config, logger)
    changes = 0
    removal = new SongRemovalService({
      storage,
      songs,
      tags,
      cloud,
      lyrics,
      covers,
      lyricsCache,
      motion: new MotionStore(config, logger),
      lyricsIndex: new LyricsIndexService({
        songs,
        search,
        lyrics,
        metadata: new MetadataService(storage, logger),
        logger,
      }),
      onChange: () => {
        changes++
      },
      logger,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  /** A song in its own folder, with a sidecar beside it, as an import lays one out. */
  const addSong = (name: string): { id: number; key: string } => {
    const key = `${name}/${name}.m4a`
    const folder = path.join(root, 'library', name)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, `${name}.m4a`), 'audio')
    fs.writeFileSync(path.join(folder, `${name}.lrc`), '[00:01.00] la')
    const id = songs.insert({
      path: key,
      title: name,
      artist: '',
      album: '',
      albumArtist: '',
      trackNo: null,
      year: null,
      duration: 180,
      sizeBytes: 5,
      mime: 'audio/mp4',
      mtimeMs: 1_700_000_000_000,
      hasArt: false,
      artExt: null,
      lyricsKind: 'synced',
      sourceUrl: null,
    })
    return { id, key }
  }

  const onDisk = (relative: string): boolean => fs.existsSync(path.join(root, 'library', relative))
  const cacheFolder = (id: number): boolean =>
    fs.existsSync(path.join(dataDir, 'lyrics', String(id)))

  /** As the cloud pass would have left it: every file up, under a key each. */
  const uploaded = (id: number, name: string): { audio: string; cover: string } => {
    const audio = `audio/${name}.m4a`
    const cover = `covers/${name}.jpg`
    cloud.recordFile(audio, 5)
    cloud.recordFile(cover, 3)
    cloud.saveState({
      songId: id,
      audioKey: audio,
      audioSize: 5,
      audioSig: '5-1700000000000',
      coverKey: cover,
      coverSize: 3,
      coverSig: 'art-1',
      lyricsKey: null,
      lyricsSize: null,
      lyricsKind: null,
      romanizedKey: null,
      lyricsSig: 'tags-5-1700000000000',
      motionKey: null,
      motionSig: 'none',
    })
    return { audio, cover }
  }

  describe('remove', () => {
    it('takes a tag out with the last song that had it', async () => {
      const one = addSong('A - One')
      const two = addSong('B - Two')
      const chill = tags.create('chill')
      const loud = tags.create('loud')
      tags.addToSong(one.id, chill.id)
      tags.addToSong(two.id, loud.id)

      const result = await removal.remove([one.id])

      expect(result).toEqual({ removed: [one.id], failed: [] })
      expect(tags.all().map(tag => tag.name)).toEqual(['loud'])
      expect(songs.byId(two.id)).not.toBeNull()
      expect(changes).toBe(1)
    })

    it('deletes the copy on disk, its sidecar and the folder they were in', async () => {
      const { id, key } = addSong('A - One')

      const result = await removal.remove([id])

      expect(result).toEqual({ removed: [id], failed: [] })
      expect(onDisk(key)).toBe(false)
      expect(onDisk('A - One/A - One.lrc')).toBe(false)
      expect(onDisk('A - One')).toBe(false)
    })

    it('puts the song’s bucket files in the trash, and leaves another song’s alone', async () => {
      const gone = addSong('A - One')
      const kept = addSong('B - Two')
      const goneUid = (
        db.prepare('SELECT uid FROM songs WHERE id = ?').get(gone.id) as { uid: string }
      ).uid
      const theirs = uploaded(gone.id, 'one')
      const others = uploaded(kept.id, 'two')

      await removal.remove([gone.id])

      // Nothing is deleted from the bucket here: the snapshot every device is
      // reading still names these, and the pass lets them go once it does not.
      expect(cloud.trashedKeys()).toEqual([theirs.audio, theirs.cover].sort())
      // And the song itself is remembered, so adoption cannot hand it back
      // from the snapshot that still lists it.
      expect(cloud.wasRemoved(goneUid)).toBe(true)
      expect(cloud.hasFile(theirs.audio)).toBe(true)
      expect(cloud.hasFile(others.audio)).toBe(true)
    })

    it('does not trash a file another song still points at', async () => {
      const gone = addSong('A - One')
      const kept = addSong('B - Two')
      uploaded(gone.id, 'shared')
      uploaded(kept.id, 'shared')

      await removal.remove([gone.id])

      expect(cloud.trashedKeys()).toEqual([])
    })

    it('clears everything derived from the row', async () => {
      const { id } = addSong('A - One')
      await covers.save(id, Buffer.from('png'), '.png')
      await lyricsCache.write(id, 'romaji', 'abcd', { lines: [] })
      search.replace(id, 'abcd', ['la la'])

      await removal.remove([id])

      expect(covers.find(id)).toBeNull()
      expect(cacheFolder(id)).toBe(false)
      expect(search.indexedHash(id)).toBeNull()
    })

    it('removes the row of a song whose copy here had already gone', async () => {
      const { id, key } = addSong('A - One')
      fs.rmSync(path.join(root, 'library', key))

      const result = await removal.remove([id])

      expect(result).toEqual({ removed: [id], failed: [] })
      expect(songs.byId(id)).toBeNull()
      expect(onDisk('A - One')).toBe(false)
    })

    it('reports ids it does not know without changing anything', async () => {
      const { id } = addSong('A - One')

      const result = await removal.remove([id, 999])

      expect(result.removed).toEqual([id])
      expect(result.failed).toEqual([
        { songId: 999, reason: 'no song with id 999', removed: false },
      ])
      expect(changes).toBe(1)

      expect(await removal.remove([999])).toEqual({
        removed: [],
        failed: [{ songId: 999, reason: 'no song with id 999', removed: false }],
      })
      expect(changes).toBe(1)
    })
  })

  describe('tidyAfter', () => {
    it('clears what hung off a row another device removed, the copy on disk included', async () => {
      const one = addSong('A - One')
      const two = addSong('B - Two')
      await lyricsCache.write(one.id, 'romaji', 'abcd', { lines: [] })
      await lyricsCache.write(two.id, 'romaji', 'abcd', { lines: [] })
      // The cloud pass has already taken the rows, inside its own transaction.
      songs.delete(one.id)
      songs.delete(two.id)

      await removal.tidyAfter([
        { id: one.id, path: one.key },
        { id: two.id, path: two.key },
      ])

      expect(cacheFolder(one.id)).toBe(false)
      expect(cacheFolder(two.id)).toBe(false)
      expect(onDisk('A - One')).toBe(false)
      expect(onDisk('B - Two')).toBe(false)
      // The pass moves the version itself.
      expect(changes).toBe(0)
    })
  })
})
