import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
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
 * the things a song leaves behind; these pin every one of them.
 */
describe('SongRemovalService', () => {
  let root: string
  let dataDir: string
  let db: Database.Database
  let songs: SongRepository
  let tags: TagRepository
  let search: LyricsSearchRepository
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

  describe('remove', () => {
    it('takes a tag out with the last song that had it', async () => {
      const one = addSong('A - One')
      const two = addSong('B - Two')
      const chill = tags.create('chill')
      const loud = tags.create('loud')
      tags.addToSong(one.id, chill.id)
      tags.addToSong(two.id, loud.id)

      const result = await removal.remove([one.id], { deleteFile: false })

      expect(result).toEqual({ removed: [one.id], filesDeleted: 0, failed: [] })
      expect(tags.all().map(tag => tag.name)).toEqual(['loud'])
      expect(songs.byId(two.id)).not.toBeNull()
      // The row went, the file stayed: that is what "remove from my list" means.
      expect(onDisk(one.key)).toBe(true)
      expect(changes).toBe(1)
    })

    it('deletes the audio, its sidecar and the folder they were in when asked', async () => {
      const { id, key } = addSong('A - One')

      const result = await removal.remove([id], { deleteFile: true })

      expect(result).toEqual({ removed: [id], filesDeleted: 1, failed: [] })
      expect(onDisk(key)).toBe(false)
      expect(onDisk('A - One/A - One.lrc')).toBe(false)
      expect(onDisk('A - One')).toBe(false)
    })

    it('clears everything derived from the row', async () => {
      const { id } = addSong('A - One')
      await covers.save(id, Buffer.from('png'), '.png')
      await lyricsCache.write(id, 'romaji', 'abcd', { lines: [] })
      search.replace(id, 'abcd', ['la la'])

      await removal.remove([id], { deleteFile: false })

      expect(covers.find(id)).toBeNull()
      expect(cacheFolder(id)).toBe(false)
      expect(search.indexedHash(id)).toBeNull()
    })

    it('reports a file that was already gone, and still removes the row', async () => {
      const { id, key } = addSong('A - One')
      fs.rmSync(path.join(root, 'library', key))

      const result = await removal.remove([id], { deleteFile: true })

      expect(result).toEqual({
        removed: [id],
        filesDeleted: 0,
        failed: [{ songId: id, reason: 'the file was already missing from disk', removed: true }],
      })
      expect(songs.byId(id)).toBeNull()
    })

    it('reports ids it does not know without changing anything', async () => {
      const { id } = addSong('A - One')

      const result = await removal.remove([id, 999], { deleteFile: false })

      expect(result.removed).toEqual([id])
      expect(result.failed).toEqual([
        { songId: 999, reason: 'no song with id 999', removed: false },
      ])
      expect(changes).toBe(1)

      expect(await removal.remove([999], { deleteFile: false })).toEqual({
        removed: [],
        filesDeleted: 0,
        failed: [{ songId: 999, reason: 'no song with id 999', removed: false }],
      })
      expect(changes).toBe(1)
    })
  })

  describe('purgeMissing', () => {
    it('forgets a missing song and everything it left behind', async () => {
      const gone = addSong('A - One')
      const here = addSong('B - Two')
      const only = tags.create('only')
      tags.addToSong(gone.id, only.id)
      await lyricsCache.write(gone.id, 'romaji', 'abcd', { lines: [] })
      search.replace(gone.id, 'abcd', ['la la'])
      songs.markMissing(gone.key)

      expect(await removal.purgeMissing()).toBe(1)

      expect(songs.byId(gone.id)).toBeNull()
      expect(songs.byId(here.id)).not.toBeNull()
      expect(cacheFolder(gone.id)).toBe(false)
      expect(search.indexedHash(gone.id)).toBeNull()
      expect(tags.all()).toEqual([])
      expect(changes).toBe(1)
    })

    it('does nothing, quietly, when no song is missing', async () => {
      addSong('A - One')

      expect(await removal.purgeMissing()).toBe(0)
      expect(changes).toBe(0)
    })
  })

  describe('tidyAfter', () => {
    it('clears what hung off a row another device removed, and only the file it was told to', async () => {
      const kept = addSong('A - One')
      const destroyed = addSong('B - Two')
      await lyricsCache.write(kept.id, 'romaji', 'abcd', { lines: [] })
      await lyricsCache.write(destroyed.id, 'romaji', 'abcd', { lines: [] })
      // The cloud pass has already taken the rows, inside its own transaction.
      songs.delete(kept.id)
      songs.delete(destroyed.id)

      await removal.tidyAfter([
        { id: kept.id, path: kept.key, deleteFile: false },
        { id: destroyed.id, path: destroyed.key, deleteFile: true },
      ])

      expect(cacheFolder(kept.id)).toBe(false)
      expect(cacheFolder(destroyed.id)).toBe(false)
      expect(onDisk(kept.key)).toBe(true)
      expect(onDisk('B - Two')).toBe(false)
      // The pass moves the version itself.
      expect(changes).toBe(0)
    })
  })
})
