import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from '../repositories/songs.js'
import { LocalStorageDriver } from '../storage/local.js'
import { isFreeName, removeFolderIfEmpty, songKeyCandidates } from './libraryLayout.js'

/** Against a real library folder, so what is on disk afterwards is what is checked. */

describe('libraryLayout', () => {
  let root: string
  let storage: LocalStorageDriver

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-layout-'))
    storage = new LocalStorageDriver(root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const put = (key: string, content = 'x'): void => {
    fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true })
    fs.writeFileSync(path.join(root, key), content)
  }
  const has = (key: string): boolean => fs.existsSync(path.join(root, key))

  describe('songKeyCandidates', () => {
    it('gives each song a folder named like its file, numbering a second one', () => {
      const [first, second] = songKeyCandidates('YOASOBI - 群青', '.m4a')
      expect(first).toBe('YOASOBI - 群青/YOASOBI - 群青.m4a')
      expect(second).toBe('YOASOBI - 群青 (2)/YOASOBI - 群青 (2).m4a')
    })
  })

  /*
   * An import of a second "Artist - Title" after the first one's copy was let
   * go got the first one's name, and the scan took the new file for the old
   * song: its audio replaced, the old audio deleted from the bucket.
   */
  describe('isFreeName', () => {
    it('is not a name a song holds whose copy is no longer here', async () => {
      const db = new Database(':memory:')
      migrate(db, createLogger('silent'))
      const songs = new SongRepository(db)
      songs.insert({
        path: 'A - Intro/A - Intro.m4a',
        title: 'Intro',
        artist: 'A',
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

      const [first, second] = songKeyCandidates('A - Intro', '.mp3')
      // Another extension in the same folder would share the first one's words.
      expect(await isFreeName(songs, storage, first as string)).toBe(false)
      expect(await isFreeName(songs, storage, second as string)).toBe(true)
      expect(await isFreeName(songs, storage, 'A - Intr/A - Intr.m4a')).toBe(true)
      put('A - Intro (2)/x')
      expect(await isFreeName(songs, storage, second as string)).toBe(false)
      db.close()
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
