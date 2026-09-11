import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from '../repositories/songs.js'
import { LocalStorageDriver } from '../storage/local.js'
import { organizeLegacyImports, removeFolderIfEmpty, songKeyCandidates } from './libraryLayout.js'

/**
 * A real library folder and a database built from the real migrations. What
 * matters most is that a moved song is the same song afterwards — same row,
 * same tags and plays — and that nothing put in the library by hand is moved.
 */

describe('libraryLayout', () => {
  let root: string
  let storage: LocalStorageDriver
  let db: Database.Database
  let songs: SongRepository

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-layout-'))
    storage = new LocalStorageDriver(root)
    db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    songs = new SongRepository(db)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const put = (key: string, content = 'x'): void => {
    fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true })
    fs.writeFileSync(path.join(root, key), content)
  }
  const has = (key: string): boolean => fs.existsSync(path.join(root, key))
  const addSong = (id: number, key: string): void => {
    db.prepare(
      "INSERT INTO songs (id, path, title, artist) VALUES (?, ?, 'Gunjou', 'YOASOBI')",
    ).run(id, key)
  }
  const organize = () => organizeLegacyImports({ storage, songs, logger: createLogger('silent') })

  describe('songKeyCandidates', () => {
    it('gives each song a folder named like its file, numbering a second one', () => {
      const [first, second] = songKeyCandidates('YOASOBI - 群青', '.m4a')
      expect(first).toBe('YOASOBI - 群青/YOASOBI - 群青.m4a')
      expect(second).toBe('YOASOBI - 群青 (2)/YOASOBI - 群青 (2).m4a')
    })
  })

  describe('organizeLegacyImports', () => {
    it('moves an old import and its lyrics into a folder, and keeps the song', async () => {
      put('YOASOBI - 群青 [bdba990f].m4a')
      put('YOASOBI - 群青 [bdba990f].lrc', '[00:01.00] line')
      addSong(7, 'YOASOBI - 群青 [bdba990f].m4a')

      expect(await organize()).toBe(1)

      expect(has('YOASOBI - 群青/YOASOBI - 群青.m4a')).toBe(true)
      expect(has('YOASOBI - 群青/YOASOBI - 群青.lrc')).toBe(true)
      expect(has('YOASOBI - 群青 [bdba990f].m4a')).toBe(false)
      expect(has('YOASOBI - 群青 [bdba990f].lrc')).toBe(false)
      expect(songs.byId(7)?.path).toBe('YOASOBI - 群青/YOASOBI - 群青.m4a')
      expect(songs.byPath('YOASOBI - 群青 [bdba990f].m4a')).toBeNull()
    })

    it('leaves files put in the library by hand, and songs already in a folder', async () => {
      put('Mixtape.mp3')
      put('Artist/Album/01 Song.flac')
      put('YOASOBI - 群青/YOASOBI - 群青 [bdba990f].m4a')

      expect(await organize()).toBe(0)

      expect(has('Mixtape.mp3')).toBe(true)
      expect(has('Artist/Album/01 Song.flac')).toBe(true)
      expect(has('YOASOBI - 群青/YOASOBI - 群青 [bdba990f].m4a')).toBe(true)
    })

    it('numbers the folder when the name is taken, on disk or by a missing song', async () => {
      put('YOASOBI - 群青/YOASOBI - 群青.m4a')
      addSong(1, 'YOASOBI - 群青 (2)/YOASOBI - 群青 (2).m4a')
      put('YOASOBI - 群青 [bdba990f].m4a')
      addSong(2, 'YOASOBI - 群青 [bdba990f].m4a')

      await organize()

      expect(songs.byId(2)?.path).toBe('YOASOBI - 群青 (3)/YOASOBI - 群青 (3).m4a')
      expect(has('YOASOBI - 群青 (3)/YOASOBI - 群青 (3).m4a')).toBe(true)
    })

    it('has nothing to do the second time', async () => {
      put('YOASOBI - 群青 [bdba990f].m4a')
      await organize()
      expect(await organize()).toBe(0)
    })
  })

  describe('removeFolderIfEmpty', () => {
    it('removes a song folder left empty, Finder litter and all', async () => {
      put('YOASOBI - 群青/.DS_Store')
      await removeFolderIfEmpty(storage, 'YOASOBI - 群青/YOASOBI - 群青.m4a')
      expect(has('YOASOBI - 群青')).toBe(false)
    })

    it('keeps a folder that still has something in it', async () => {
      put('Artist/Album/02 Other.flac')
      await removeFolderIfEmpty(storage, 'Artist/Album/01 Song.flac')
      expect(has('Artist/Album/02 Other.flac')).toBe(true)
    })

    it('never touches the library root', async () => {
      await removeFolderIfEmpty(storage, 'Mixtape.mp3')
      expect(fs.existsSync(root)).toBe(true)
    })
  })
})
