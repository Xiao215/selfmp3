import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
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
    let recorded: string | null = null
    const setArt = vi.fn((_id: number, _has: boolean, extension: string | null) => {
      recorded = extension
    })
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt, artExt: () => recorded } as unknown as SongRepository,
      createLogger('silent'),
    )

    await covers.save(7, image(1), '.jpg')
    await covers.save(7, image(2), '.png')

    const files = fs.readdirSync(path.join(dataDir, 'covers')).sort()
    // Only the new one: an old 7.jpg would otherwise be found first and served.
    expect(files).toEqual(['7.png'])
    expect((await covers.find(7))?.path.endsWith('7.png')).toBe(true)
    expect(setArt).toHaveBeenLastCalledWith(7, true, '.png')
  })

  it('keeps no cover at all from a picture too big to read', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const setArt = vi.fn()
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt, artExt: () => null } as unknown as SongRepository,
      createLogger('silent'),
    )
    const huge = await sharp({
      create: { width: 4200, height: 4200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer()

    await covers.save(7, huge, '.png')

    expect(fs.readdirSync(path.join(dataDir, 'covers'))).toEqual([])
    expect(setArt).not.toHaveBeenCalled()
  })

  /*
   * The disk filling as a cover was written left an empty file under the
   * cover's own name, which read as the song's cover (bug bash R3-M11).
   */
  describe('with the disk full as it writes', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    /** Every write runs out of room: the file is made, and nothing fits in it. */
    const diskFull = () => {
      const write = fsp.writeFile.bind(fsp)
      vi.spyOn(fsp, 'writeFile').mockImplementation(async file => {
        await write(file as string, '')
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      })
    }

    it('leaves nothing under the cover’s name, and says it is worth another try', async () => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
      const setArt = vi.fn()
      const covers = new CoverService(
        { dataDir } as Config,
        { setArt, artExt: () => '.jpg' } as unknown as SongRepository,
        createLogger('silent'),
      )
      diskFull()

      expect(await covers.save(7, image(1), '.jpg')).toBe('failed')

      expect(fs.readdirSync(path.join(dataDir, 'covers'))).toEqual([])
      expect(setArt).not.toHaveBeenCalled()
    })

    it('keeps the cover it was replacing', async () => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
      const covers = new CoverService(
        { dataDir } as Config,
        { setArt: vi.fn(), artExt: () => '.jpg' } as unknown as SongRepository,
        createLogger('silent'),
      )
      expect(await covers.save(7, image(1), '.jpg')).toBe('kept')
      const before = fs.readFileSync(path.join(dataDir, 'covers', '7.jpg'))
      diskFull()

      await covers.save(7, image(2), '.jpg')

      expect(fs.readdirSync(path.join(dataDir, 'covers'))).toEqual(['7.jpg'])
      expect(fs.readFileSync(path.join(dataDir, 'covers', '7.jpg'))).toEqual(before)
    })
  })

  it('looks only for the format the row recorded', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt: vi.fn(), artExt: () => '.webp' } as unknown as SongRepository,
      createLogger('silent'),
    )
    fs.writeFileSync(path.join(dataDir, 'covers', '5.jpg'), image(1))
    fs.writeFileSync(path.join(dataDir, 'covers', '5.webp'), image(2))

    expect(await covers.find(5)).toMatchObject({ contentType: 'image/webp' })
  })

  it('finds no cover when the row recorded none', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt: vi.fn(), artExt: () => null } as unknown as SongRepository,
      createLogger('silent'),
    )
    fs.writeFileSync(path.join(dataDir, 'covers', '5.jpg'), image(1))

    expect(await covers.find(5)).toBeNull()
  })

  it('leaves other songs’ covers alone', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt: vi.fn(), artExt: () => null } as unknown as SongRepository,
      createLogger('silent'),
    )

    await covers.save(1, image(1), '.jpg')
    await covers.save(2, image(2), '.png')

    expect(fs.readdirSync(path.join(dataDir, 'covers')).sort()).toEqual(['1.jpg', '2.png'])
  })
})

describe('CoverService.jpegKept', () => {
  let dataDir = ''

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  const picture = (format: 'png' | 'jpeg'): Promise<Buffer> => {
    const made = sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
    return format === 'png' ? made.png().toBuffer() : made.jpeg().toBuffer()
  }

  it('makes a PNG cover kept from before a JPEG, and leaves a JPEG as it is', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const recorded = new Map<number, string | null>([
      [1, '.png'],
      [2, '.jpg'],
      [3, null],
    ])
    const setArt = vi.fn((id: number, _has: boolean, extension: string | null) => {
      recorded.set(id, extension)
    })
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt, artExt: (id: number) => recorded.get(id) ?? null } as unknown as SongRepository,
      createLogger('silent'),
    )
    const jpeg = await picture('jpeg')
    fs.writeFileSync(path.join(dataDir, 'covers', '1.png'), await picture('png'))
    fs.writeFileSync(path.join(dataDir, 'covers', '2.jpg'), jpeg)
    const saved = vi.fn()
    covers.onSaved = saved

    expect(await covers.jpegKept([1, 2, 3])).toBe(1)

    expect(fs.readdirSync(path.join(dataDir, 'covers')).sort()).toEqual(['1.jpg', '2.jpg'])
    expect((await sharp(path.join(dataDir, 'covers', '1.jpg')).metadata()).format).toBe('jpeg')
    // Untouched, byte for byte: its hash, the bucket's name for it, stays.
    expect(fs.readFileSync(path.join(dataDir, 'covers', '2.jpg'))).toEqual(jpeg)
    expect(setArt).toHaveBeenCalledTimes(1)
    expect(saved).toHaveBeenCalledWith(1)

    // A second start finds nothing to do.
    expect(await covers.jpegKept([1, 2, 3])).toBe(0)
  })

  it('leaves a cover sharp cannot read unsaved, start after start', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const setArt = vi.fn()
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt, artExt: () => '.png' } as unknown as SongRepository,
      createLogger('silent'),
    )
    fs.writeFileSync(path.join(dataDir, 'covers', '1.png'), image(3))
    const saved = vi.fn()
    covers.onSaved = saved

    expect(await covers.jpegKept([1])).toBe(0)
    expect(await covers.jpegKept([1])).toBe(0)

    // Not saved again as it was: that would count its revision on each start.
    expect(setArt).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(dataDir, 'covers', '1.png'))).toEqual(image(3))
  })
})

describe('CoverService.thumbnail', () => {
  let dataDir = ''

  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('makes one whole thumbnail for requests that arrive together', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      { setArt: vi.fn(), artExt: () => '.jpg' } as unknown as SongRepository,
      createLogger('silent'),
    )
    const original = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#c04020' },
    })
      .jpeg()
      .toBuffer()
    await covers.save(3, original, '.jpg')

    const [first, second] = await Promise.all([covers.thumbnail(3, 96), covers.thumbnail(3, 96)])

    expect(second?.path).toBe(first?.path)
    expect(first?.path).toMatch(/3-96-[0-9a-f]+\.jpg$/)
    // Nothing half-written left beside it under another name.
    expect(fs.readdirSync(path.join(dataDir, 'covers', 'thumbs'))).toHaveLength(1)
    const made = await sharp(first?.path ?? '').metadata()
    expect(made).toMatchObject({ format: 'jpeg', width: 96, height: 96 })
  })

  it('drops a song’s thumbnails when its cover is replaced, and sweeps any left from before', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const covers = new CoverService(
      { dataDir } as Config,
      {
        setArt: vi.fn(),
        artExt: (id: number) => (id === 3 ? '.jpg' : null),
      } as unknown as SongRepository,
      createLogger('silent'),
    )
    const original = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#c04020' },
    })
      .jpeg()
      .toBuffer()
    await covers.save(3, original, '.jpg')
    const made = await covers.thumbnail(3, 96)
    await covers.save(3, original, '.jpg')
    const thumbs = path.join(dataDir, 'covers', 'thumbs')
    // Made from the picture just replaced: no request names it again.
    expect(fs.existsSync(made?.path ?? '')).toBe(false)

    // Left by covers replaced before replacing dropped them, and a song with no cover.
    const current = await covers.thumbnail(3, 96)
    fs.writeFileSync(path.join(thumbs, '3-96-1.jpg'), 'letterboxed')
    fs.writeFileSync(path.join(thumbs, '9-96-1.jpg'), 'no cover now')

    expect(await covers.sweepThumbnails()).toBe(2)
    expect(fs.readdirSync(thumbs)).toEqual([path.basename(current?.path ?? '')])
  })
})

describe('CoverService.saveFromUrl', () => {
  let dataDir = ''
  let server: http.Server | null = null

  afterEach(() => {
    server?.close()
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('fetches art from the open web only', async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-covers-'))
    const art = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#2040c0' },
    })
      .png()
      .toBuffer()
    server = http.createServer((_request, response) => {
      response
        .writeHead(200, { 'content-type': 'image/png' })
        .end(Buffer.concat([art, Buffer.alloc(1024)]))
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/art.png`
    const songs = { setArt: vi.fn(), artExt: () => null } as unknown as SongRepository

    // A link to this machine — its API, its admin page — is never fetched.
    const guarded = new CoverService({ dataDir } as Config, songs, createLogger('silent'))
    expect(await guarded.saveFromUrl(1, url)).toBe(false)
    expect(await guarded.saveFromUrl(1, 'file:///etc/passwd')).toBe(false)

    const widened = new CoverService(
      { dataDir } as Config,
      songs,
      createLogger('silent'),
      address => address === '127.0.0.1',
    )
    expect(await widened.saveFromUrl(1, url)).toBe(true)
  })
})
