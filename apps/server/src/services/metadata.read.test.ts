import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FileTokenizer } from 'strtok3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.js'
import { LocalStorageDriver } from '../storage/local.js'
import { MetadataService } from './metadata.js'

/**
 * A file still being written when its tags are read (bug bash R3-M3).
 *
 * The reader takes a file's size once, as it opens it. Written to after that,
 * the file holds more than the size says, and counting its MP3 frames to the
 * end, the reader goes past the size, counts its place backwards and never
 * finishes. Here the size is made smaller than the file as it opens, which is
 * that state without having to catch an encoder in the act.
 */

const opened: FileTokenizer[] = []
/** Files to open as if they had been this many bytes when opened. */
const sizeAtOpen = new Map<string, number>()

vi.mock('strtok3', async original => {
  const real = await original<typeof import('strtok3')>()
  return {
    ...real,
    fromFile: async (file: string, options?: Parameters<typeof real.fromFile>[1]) => {
      const tokenizer = await real.fromFile(file, options)
      const size = sizeAtOpen.get(file)
      if (size !== undefined) tokenizer.fileInfo.size = size
      opened.push(tokenizer)
      return tokenizer
    },
  }
})

/** MPEG-1 Layer III frames, mono at 44.1 kHz, of changing bitrates: VBR, read frame by frame. */
function vbrMp3(frames: number): Buffer {
  const rates = [
    [9, 128],
    [10, 160],
    [11, 192],
  ] as const
  return Buffer.concat(
    Array.from({ length: frames }, (_, i) => {
      const [index, kbps] = rates[i % rates.length] ?? rates[0]
      const frame = Buffer.alloc(Math.floor((144 * kbps * 1000) / 44100))
      frame.set([0xff, 0xfb, index << 4, 0xc0])
      return frame
    }),
  )
}

const roots: string[] = []
afterEach(() => {
  sizeAtOpen.clear()
  opened.length = 0
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function setUp(limitMs: number) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-growing-')))
  roots.push(root)
  const data = vbrMp3(400)
  fs.writeFileSync(path.join(root, 'Long - Song.mp3'), data)
  const storage = new LocalStorageDriver(root)
  const metadata = new MetadataService(storage, createLogger('silent'), { limitMs })
  return { root, data, metadata }
}

describe('reading a file that grew after it was opened', () => {
  it('gives up when the time runs out, and stops reading', async () => {
    const { root, data, metadata } = setUp(300)
    sizeAtOpen.set(path.join(root, 'Long - Song.mp3'), Math.floor(data.length / 3))

    await expect(metadata.read('Long - Song.mp3')).rejects.toThrow(/took longer/)

    // Closed under the reader, so its loop ends instead of spinning a core.
    const [tokenizer] = opened
    await expect(tokenizer?.peekBuffer(new Uint8Array(4))).rejects.toThrow()
  })

  it('reads the same file whole as it always did', async () => {
    const { metadata } = setUp(300)

    const read = await metadata.read('Long - Song.mp3')

    expect(read.duration).toBeCloseTo(10.45, 1)
    expect(read).toMatchObject({ artist: 'Long', title: 'Song' })
  })

  it('reads a file that is not audio as its name, as before', async () => {
    const { root, metadata } = setUp(300)
    fs.writeFileSync(path.join(root, 'Not - Audio.mp3'), 'text, not a song\n'.repeat(40))

    expect(await metadata.read('Not - Audio.mp3')).toMatchObject({
      artist: 'Not',
      title: 'Audio',
      duration: 0,
    })
  })
})
