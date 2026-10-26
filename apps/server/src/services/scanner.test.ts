import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from '../repositories/songs.js'
import type { StorageDriver } from '../storage/index.js'
import { LocalStorageDriver } from '../storage/local.js'
import { audioKey, type ScanResult } from '@selfmp3/shared'
import { sha256 } from '../util/hash.js'
import { LyricsService } from './lyrics.js'
import { MetadataService } from './metadata.js'
import { ScannerService } from './scanner.js'

/**
 * What a sweep does when one file will not be read.
 *
 * A truncated download, a permission the copy did not carry, a format the tag
 * reader gives up on. Whatever the reason, the rest of the folder is still
 * there and still has to be swept.
 */

const BAD = 'Broken - Track.m4a'

function build(files: string[]) {
  const db = new Database(':memory:')
  const logger = createLogger('silent')
  migrate(db, logger)
  const songs = new SongRepository(db)

  const storage = {
    list: () => Promise.resolve(files),
    stat: (key: string) =>
      Promise.resolve({ sizeBytes: 100, modifiedAt: new Date(1_700_000_000_000), key }),
  } as unknown as StorageDriver & { stat: StorageDriver['stat'] }

  const metadata = {
    read: (key: string) => {
      if (key === BAD) return Promise.reject(new Error('end of stream'))
      return Promise.resolve({
        title: key,
        artist: '',
        album: '',
        albumArtist: '',
        trackNo: null,
        year: null,
        duration: 180,
        picture: null,
        embeddedLyrics: null,
      })
    },
  }

  const scanner = new ScannerService({
    storage,
    songs,
    metadata: metadata as never,
    lyrics: { detectKind: () => Promise.resolve('none') } as never,
    covers: { save: () => Promise.resolve(), delete: () => Promise.resolve() } as never,
    logger,
  })

  return { db, songs, scanner, storage }
}

describe('a scan that meets a file it cannot read', () => {
  it('scans every other file instead of stopping there', async () => {
    const { songs, scanner } = build(['A - One.m4a', BAD, 'C - Three.m4a'])

    const result = await scanner.scan()

    expect(result.added).toBe(2)
    expect(songs.allPaths().has('C - Three.m4a')).toBe(true)
  })

  it('leaves a song alone whose file is not in the folder: it is in the bucket', async () => {
    const { db, songs, scanner } = build(['A - One.m4a', BAD])
    db.exec("INSERT INTO songs (id, path, title) VALUES (99, 'Gone - Song.m4a', 'Gone');")

    const result = await scanner.scan()

    expect(result).toMatchObject({ added: 1, updated: 0 })
    expect(songs.byId(99)).not.toBeNull()
  })

  it('leaves the bad file out of the library rather than half-adding it', async () => {
    const { songs, scanner } = build([BAD])

    await scanner.scan()

    expect(songs.allPaths().has(BAD)).toBe(false)
  })

  it('can run again afterwards', async () => {
    const { scanner } = build(['A - One.m4a', BAD])

    await scanner.scan()
    const second = await scanner.scan()

    // The good file is unchanged the second time, and nothing is stuck running.
    expect(second.added).toBe(0)
    expect(scanner.isRunning).toBe(false)
  })
})

/**
 * What a sweep reports is what changed since the last one. Every caller bumps
 * the library version on a non-zero count, and every device refetches on a
 * bump, so a quiet sweep of a folder with nothing new in it has to say so.
 *
 * A file that is not in the folder any more says nothing at all: the bucket
 * is the library, and a copy here is let go once the song is up. The row
 * stays, untouched, and comes to no harm.
 */
describe('a sweep of a folder that has not changed', () => {
  const nothing = { added: 0, updated: 0 }
  const writes = (db: Database.Database): number =>
    (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

  it('says nothing when a file has gone, and keeps the song', async () => {
    const files = ['A - One.m4a', 'B - Two.m4a']
    const { songs, scanner } = build(files)
    await scanner.scan()

    files.pop()
    expect(await scanner.scan()).toMatchObject(nothing)
    expect(songs.byPath('B - Two.m4a')).not.toBeNull()
    expect(await scanner.scan()).toMatchObject(nothing)
  })

  it('writes nothing at all when every file is as it was', async () => {
    const { db, scanner } = build(['A - One.m4a', 'B - Two.m4a'])
    await scanner.scan()

    const before = writes(db)
    expect(await scanner.scan()).toMatchObject(nothing)
    expect(writes(db)).toBe(before)
  })

  it('does not count a file that came back, unchanged, as anything', async () => {
    const files = ['A - One.m4a', 'B - Two.m4a']
    const { scanner } = build(files)
    await scanner.scan()
    const gone = files.pop() as string
    await scanner.scan()

    files.push(gone)
    expect(await scanner.scan()).toMatchObject(nothing)
  })

  it('re-reads a file whose time has moved', async () => {
    const files = ['A - One.m4a']
    const { scanner, storage } = build(files)
    await scanner.scan()

    storage.stat = (key: string) =>
      Promise.resolve({ sizeBytes: 100, modifiedAt: new Date(1_700_000_001_000), key })
    expect(await scanner.scan()).toMatchObject({ added: 0, updated: 1 })
  })
})

/** A second of silence as a 16-bit mono WAV: the smallest real audio to hand. */
function wav(): Buffer {
  const rate = 8000
  const data = Buffer.alloc(rate * 2)
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}

describe('a sweep over files that are not audio', () => {
  it('makes songs of audio only, whatever the extension says', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-junk-'))
    try {
      fs.writeFileSync(path.join(root, 'empty.m4a'), '')
      fs.writeFileSync(path.join(root, 'fake.mp3'), 'this is a text file, not a song\n'.repeat(40))
      fs.writeFileSync(
        path.join(root, 'random.flac'),
        Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 256)),
      )
      fs.writeFileSync(path.join(root, 'Real - Song.wav'), wav())
      const db = new Database(':memory:')
      const logger = createLogger('silent')
      migrate(db, logger)
      const songs = new SongRepository(db)
      const storage = new LocalStorageDriver(root)
      const scanner = new ScannerService({
        storage,
        songs,
        metadata: new MetadataService(storage, logger),
        lyrics: { detectKind: () => Promise.resolve('none') } as never,
        covers: { save: () => Promise.resolve() } as never,
        logger,
        settleMs: 0,
      })

      expect(await scanner.scan()).toMatchObject({ added: 1 })
      expect([...songs.allPaths().keys()]).toEqual(['Real - Song.wav'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('a sweep while a removed song’s copy is still being deleted', () => {
  it('does not bring the song back', async () => {
    const { songs, scanner } = build(['A - One.m4a', 'B - Two.m4a'])
    scanner.isLeaving = key => key === 'B - Two.m4a'

    expect(await scanner.scan()).toMatchObject({ added: 1 })
    expect(songs.byPath('B - Two.m4a')).toBeNull()
    await expect(scanner.ingest('B - Two.m4a')).rejects.toThrow(/being removed/)
  })
})

/*
 * With the bucket the library, a song's copy here goes once it is up, and its
 * name is free on disk while the row still holds it. A different file dropped
 * in under that name was taken for the song: its audio replaced the song's,
 * the song's own was deleted from the bucket, and the new song never appeared.
 */
describe('a new file under the name of a song whose copy was let go', () => {
  /** A WAV whose length says which one it is. */
  const wavOf = (seconds: number): Buffer => {
    const one = wav()
    const data = Buffer.alloc(8000 * 2 * seconds)
    const head = Buffer.from(one.subarray(0, 44))
    head.writeUInt32LE(36 + data.length, 4)
    head.writeUInt32LE(data.length, 40)
    return Buffer.concat([head, data])
  }

  const setUp = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-reused-'))
    const db = new Database(':memory:')
    const logger = createLogger('silent')
    migrate(db, logger)
    const songs = new SongRepository(db)
    const storage = new LocalStorageDriver(root)
    const scanner = new ScannerService({
      storage,
      songs,
      metadata: new MetadataService(storage, logger),
      lyrics: new LyricsService(storage, logger, () => Promise.reject(new Error('offline'))),
      covers: { save: () => Promise.resolve() } as never,
      logger,
      settleMs: 0,
    })
    /** What is in the bucket for each song: the key of its audio, by its bytes. */
    const inBucket = new Map<number, string>()
    scanner.bucketAudio = songId => inBucket.get(songId) ?? null
    const put = (name: string, data: Buffer): void => {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
      fs.writeFileSync(path.join(root, name), data)
    }
    /** Up in the bucket, and the copy here let go. */
    const letGo = (id: number, name: string, data: Buffer): void => {
      inBucket.set(id, audioKey(sha256(data), path.extname(name)))
      fs.rmSync(path.join(root, name))
    }
    return { root, songs, scanner, put, letGo, done: () => fs.rmSync(root, { recursive: true }) }
  }

  it('makes it a song of its own, and leaves the first one as it was', async () => {
    const { root, songs, scanner, put, letGo, done } = setUp()
    try {
      const first = wavOf(2)
      put('fresh3.wav', first)
      await scanner.scan()
      const id = songs.byPath('fresh3.wav')?.id as number
      letGo(id, 'fresh3.wav', first)
      const before = songs.byId(id)

      put('fresh3.wav', wavOf(1))
      fs.writeFileSync(path.join(root, 'fresh3.lrc'), '[00:00.50] its own words')
      expect(await scanner.scan()).toMatchObject({ added: 1, updated: 0 })

      expect(songs.byId(id)).toEqual(before)
      const other = songs.byPath('fresh3 (2).wav')
      expect(other?.duration).toBeCloseTo(1, 1)
      expect(fs.existsSync(path.join(root, 'fresh3.wav'))).toBe(false)
      // Its words went with it, rather than staying to be the first song's.
      expect(fs.readdirSync(root).sort()).toEqual(['fresh3 (2).lrc', 'fresh3 (2).wav'])
    } finally {
      done()
    }
  })

  it('still takes a change for the song while the file here is its only copy', async () => {
    const { songs, scanner, put, done } = setUp()
    try {
      put('A - One.wav', wavOf(2))
      await scanner.scan()
      const id = songs.byPath('A - One.wav')?.id
      put('A - One.wav', wavOf(1))

      const result = await scanner.ingest('A - One.wav')
      expect(result).toBe(id)
      expect(songs.byPath('A - One.wav')?.duration).toBeCloseTo(1, 1)
    } finally {
      done()
    }
  })

  it('takes the same bytes coming back as the song’s own copy', async () => {
    const { songs, scanner, put, letGo, done } = setUp()
    try {
      const first = wavOf(2)
      put('A - One.wav', first)
      await scanner.scan()
      const id = songs.byPath('A - One.wav')?.id as number
      letGo(id, 'A - One.wav', first)

      put('A - One.wav', first)
      expect(await scanner.ingest('A - One.wav')).toBe(id)
      expect(songs.all()).toHaveLength(1)
    } finally {
      done()
    }
  })
})

/*
 * A file in the middle of being written — a copy, a download, an encoder
 * writing in place — is not read until it has been still for a moment: read
 * half-written, it is a song cut short, or a read that never ends and holds
 * every sweep after it (bug bash R3-M3).
 */
describe('a sweep while a file is still arriving', () => {
  it('leaves it for a sweep of its own once it has been still, and says so', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-arriving-'))
    const logger = createLogger('silent')
    const db = new Database(':memory:')
    migrate(db, logger)
    const songs = new SongRepository(db)
    const storage = new LocalStorageDriver(root)
    const scanner = new ScannerService({
      storage,
      songs,
      metadata: new MetadataService(storage, logger),
      lyrics: { detectKind: () => Promise.resolve('none') } as never,
      covers: { save: () => Promise.resolve() } as never,
      logger,
      settleMs: 400,
    })
    const swept: ScanResult[] = []
    scanner.onScanComplete = result => swept.push(result)
    try {
      const old = path.join(root, 'Old - Song.wav')
      fs.writeFileSync(old, wav())
      fs.utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
      fs.writeFileSync(path.join(root, 'New - Song.wav'), wav())

      // The file left alone long ago is read; the one just written waits.
      expect(await scanner.scan()).toMatchObject({ added: 1 })
      expect(songs.byPath('New - Song.wav')).toBeNull()

      // And the scanner comes back for it by itself, telling whoever listens.
      await vi.waitFor(() => expect(songs.byPath('New - Song.wav')).not.toBeNull(), {
        timeout: 3_000,
      })
      expect(swept.at(-1)).toMatchObject({ added: 1 })
    } finally {
      scanner.stop()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  /*
   * An encoder fed slowly writes in bursts: ffmpeg at 30× wrote every 2.2 s,
   * and a file still for 2 s was read a quarter of the way in, sent, and its
   * copy let go while the rest was still being written (bug bash R4 NEW).
   */
  it('waits longer than the gap between an encoder’s writes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-arriving-'))
    const logger = createLogger('silent')
    const db = new Database(':memory:')
    migrate(db, logger)
    const songs = new SongRepository(db)
    const storage = new LocalStorageDriver(root)
    const scanner = new ScannerService({
      storage,
      songs,
      metadata: new MetadataService(storage, logger),
      lyrics: { detectKind: () => Promise.resolve('none') } as never,
      covers: { save: () => Promise.resolve() } as never,
      logger,
    })
    try {
      const file = path.join(root, 'Long - Hour.wav')
      fs.writeFileSync(file, wav())
      const lastWrite = new Date(Date.now() - 5_000)
      fs.utimesSync(file, lastWrite, lastWrite)

      expect(await scanner.scan()).toMatchObject({ added: 0 })
      expect(songs.byPath('Long - Hour.wav')).toBeNull()
    } finally {
      scanner.stop()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('takes nothing from a file that grew while it was read, and reads it again', async () => {
    const logger = createLogger('silent')
    const db = new Database(':memory:')
    migrate(db, logger)
    const songs = new SongRepository(db)
    let size = 100
    const storage = {
      list: () => Promise.resolve(['Long - Hour.mp3']),
      stat: (key: string) =>
        Promise.resolve({ sizeBytes: size, modifiedAt: new Date(1_700_000_000_000), key }),
    } as unknown as StorageDriver
    let reads = 0
    const metadata = {
      read: () => {
        // The first read meets the writer still going.
        if (reads++ === 0) size = 400
        return Promise.resolve({
          title: 'Hour',
          artist: 'Long',
          album: '',
          albumArtist: '',
          trackNo: null,
          year: null,
          duration: reads === 1 ? 900 : 3600,
          picture: null,
          embeddedLyrics: null,
        })
      },
    }
    const scanner = new ScannerService({
      storage,
      songs,
      metadata: metadata as never,
      lyrics: { detectKind: () => Promise.resolve('none') } as never,
      covers: { save: () => Promise.resolve() } as never,
      logger,
      settleMs: 50,
    })
    try {
      expect(await scanner.scan()).toMatchObject({ added: 0 })
      expect(songs.count()).toBe(0)

      // Back by itself, it reads the whole of it.
      await vi.waitFor(() => expect(songs.byPath('Long - Hour.mp3')).not.toBeNull(), {
        timeout: 2_000,
      })
      expect(songs.byPath('Long - Hour.mp3')).toMatchObject({ duration: 3600, sizeBytes: 400 })
    } finally {
      scanner.stop()
    }
  })

  it('comes back no more once stopped', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-arriving-'))
    const logger = createLogger('silent')
    const db = new Database(':memory:')
    migrate(db, logger)
    const storage = new LocalStorageDriver(root)
    const scanner = new ScannerService({
      storage,
      songs: new SongRepository(db),
      metadata: new MetadataService(storage, logger),
      lyrics: { detectKind: () => Promise.resolve('none') } as never,
      covers: { save: () => Promise.resolve() } as never,
      logger,
      settleMs: 200,
    })
    const swept: ScanResult[] = []
    scanner.onScanComplete = result => swept.push(result)
    try {
      fs.writeFileSync(path.join(root, 'New - Song.wav'), wav())
      await scanner.scan()
      scanner.stop()
      // The library closed: its database with it, so no sweep may follow.
      db.close()
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(swept).toHaveLength(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

/*
 * A cover the disk had no room for as the sweep kept it. The file is the only
 * place it is, and the copy is let go once the song is up, so it was lost for
 * good (bug bash R3-M11). It is read again, from the same file, until it is
 * kept.
 */
describe('a cover that could not be kept', () => {
  const picture = { data: Buffer.from('a picture'), extension: '.jpg' }

  const setUp = () => {
    const logger = createLogger('silent')
    const db = new Database(':memory:')
    migrate(db, logger)
    const songs = new SongRepository(db)
    const storage = {
      list: () => Promise.resolve(['A - One.m4a']),
      stat: (key: string) =>
        Promise.resolve({ sizeBytes: 100, modifiedAt: new Date(1_700_000_000_000), key }),
    } as unknown as StorageDriver
    let reads = 0
    const metadata = {
      read: () => {
        reads++
        return Promise.resolve({
          title: 'One',
          artist: 'A',
          album: '',
          albumArtist: '',
          trackNo: null,
          year: null,
          duration: 180,
          picture,
          embeddedLyrics: null,
        })
      },
    }
    /** The disk has room again once this is set. */
    const disk = { full: true }
    const covers = {
      save: (songId: number) => {
        if (disk.full) return Promise.resolve('failed')
        songs.setArt(songId, true, '.jpg')
        return Promise.resolve('kept')
      },
    }
    const scanner = new ScannerService({
      storage,
      songs,
      metadata: metadata as never,
      lyrics: { detectKind: () => Promise.resolve('none') } as never,
      covers: covers as never,
      logger,
    })
    return { songs, scanner, disk, reads: () => reads }
  }

  it('is read again by the next sweep, though the file has not changed', async () => {
    const { songs, scanner, disk, reads } = setUp()
    try {
      expect(await scanner.scan()).toMatchObject({ added: 1 })
      const id = songs.byPath('A - One.m4a')?.id as number
      expect(songs.byId(id)?.hasArt).toBe(false)
      expect(songs.isCoverToRead(id)).toBe(true)

      // Still full: tried again, and still to do.
      expect(await scanner.scan()).toMatchObject({ added: 0, updated: 0 })
      expect(songs.isCoverToRead(id)).toBe(true)

      disk.full = false
      expect(await scanner.scan()).toMatchObject({ added: 0, updated: 1 })
      expect(songs.byId(id)?.hasArt).toBe(true)
      expect(songs.isCoverToRead(id)).toBe(false)

      // Kept, it is not read again.
      const before = reads()
      expect(await scanner.scan()).toMatchObject({ added: 0, updated: 0 })
      expect(reads()).toBe(before)
    } finally {
      scanner.stop()
    }
  })

  it('brings the scanner back by itself to try again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { songs, scanner, disk } = setUp()
    try {
      await scanner.scan()
      const id = songs.byPath('A - One.m4a')?.id as number
      disk.full = false

      await vi.advanceTimersByTimeAsync(60_000)

      await vi.waitFor(() => expect(songs.byId(id)?.hasArt).toBe(true))
    } finally {
      scanner.stop()
      vi.useRealTimers()
    }
  })

  it('is let be once the file it was in has gone', async () => {
    const { songs, scanner } = setUp()
    try {
      await scanner.scan()
      const id = songs.byPath('A - One.m4a')?.id as number

      const after = new ScannerService({
        storage: { list: () => Promise.resolve([]) } as unknown as StorageDriver,
        songs,
        metadata: {} as never,
        lyrics: {} as never,
        covers: {} as never,
        logger: createLogger('silent'),
      })
      await after.scan()

      expect(songs.isCoverToRead(id)).toBe(false)
    } finally {
      scanner.stop()
    }
  })
})
