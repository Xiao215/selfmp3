import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.js'
import type { Config } from '../config.js'
import type { SongRepository } from '../repositories/songs.js'
import { CoverService } from './covers.js'

/** Enough bytes to look like an image to anything that checks the size. */
const image = (fill: number): Buffer => Buffer.alloc(2048, fill)

describe('CoverService.save', () => {
  let dataDir = ''

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('replaces a cover in another format instead of leaving it behind', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const setArt = vi.fn()
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt } as unknown as SongRepository,
      createLogger('silent'),
    )

    await covers.save(7, image(1), '.jpg')
    await covers.save(7, image(2), '.png')

    const files = fs.readdirSync(path.join(dataDir, 'covers')).sort()
    // Only the new one: an old 7.jpg would otherwise be found first and served.
    expect(files).toEqual(['7.png'])
    expect(covers.find(7)?.path.endsWith('7.png')).toBe(true)
    expect(setArt).toHaveBeenLastCalledWith(7, true, '.png')
  })

  it('leaves other songs’ covers alone', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt: vi.fn() } as unknown as SongRepository,
      createLogger('silent'),
    )

    await covers.save(1, image(1), '.jpg')
    await covers.save(2, image(2), '.png')

    expect(fs.readdirSync(path.join(dataDir, 'covers')).sort()).toEqual(['1.jpg', '2.png'])
  })
})
