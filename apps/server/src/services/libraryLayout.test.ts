import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageDriver } from '../storage/local.js'
import { removeFolderIfEmpty, songKeyCandidates } from './libraryLayout.js'

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
