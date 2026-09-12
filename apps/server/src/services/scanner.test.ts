import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Config } from '../config.js'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { SongRepository } from '../repositories/songs.js'
import type { StorageDriver } from '../storage/index.js'
import { ScannerService } from './scanner.js'

/**
 * What a scan does when one file will not be read.
 *
 * A truncated download, a permission the copy did not carry, a format the tag
 * reader gives up on. Whatever the reason, the rest of the library is still
 * there and still has to be scanned — and the songs whose files really are
 * gone still have to be marked missing.
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
  } as unknown as StorageDriver

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
    config: {} as Config,
    storage,
    songs,
    metadata: metadata as never,
    lyrics: { detectKind: () => Promise.resolve('none') } as never,
    covers: { save: () => Promise.resolve(), delete: () => Promise.resolve() } as never,
    logger,
  })

  return { db, songs, scanner }
}

describe('a scan that meets a file it cannot read', () => {
  it('scans every other file instead of stopping there', async () => {
    const { songs, scanner } = build(['A - One.m4a', BAD, 'C - Three.m4a'])

    const result = await scanner.scan()

    expect(result.added).toBe(2)
    expect(songs.allPaths().has('C - Three.m4a')).toBe(true)
  })

  it('still marks songs whose files are gone', async () => {
    const { db, songs, scanner } = build(['A - One.m4a', BAD])
    db.exec("INSERT INTO songs (id, path, title) VALUES (99, 'Gone - Song.m4a', 'Gone');")

    const result = await scanner.scan()

    expect(result.removed).toBe(1)
    expect(songs.byId(99)?.missing).toBe(true)
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
