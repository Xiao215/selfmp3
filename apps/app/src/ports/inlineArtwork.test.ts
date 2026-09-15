import { describe, expect, it, vi } from 'vitest'

import { artworkInliner, artworkLoadable } from './inlineArtwork'

const KEPT = 'app://selfmp3/_media/covers/1-2fh19.jpg'

describe('artworkInliner', () => {
  it('leaves an address Chromium can load as it is, and reads nothing', async () => {
    const read = vi.fn()
    const inliner = artworkInliner(read)
    for (const src of ['http://localhost:4610/api/art/1', 'https://x/a.jpg', 'data:image/png;base64,AA', 'blob:abc']) {
      expect(artworkLoadable(src)).toBe(true)
      expect(inliner.ready(src)).toBe(src)
      expect(await inliner.load(src)).toBe(src)
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('hands a kept app:// cover over as a data: address with its bytes', async () => {
    const read = vi.fn(async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }))
    const inliner = artworkInliner(read)

    expect(artworkLoadable(KEPT)).toBe(false)
    expect(inliner.ready(KEPT)).toBeNull()
    expect(await inliner.load(KEPT)).toBe('data:image/jpeg;base64,/9j/')
    expect(read).toHaveBeenCalledWith(KEPT)
  })

  it('reads a cover once, then has it ready', async () => {
    const read = vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
    const inliner = artworkInliner(read)

    const first = await inliner.load(KEPT)
    expect(inliner.ready(KEPT)).toBe(first)
    expect(await inliner.load(KEPT)).toBe(first)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('gives no picture for a cover it cannot read, rather than throwing', async () => {
    const inliner = artworkInliner(async () => {
      throw new Error('gone')
    })
    expect(await inliner.load(KEPT)).toBeNull()
    expect(inliner.ready(KEPT)).toBeNull()
  })

  it('keeps only the last few covers', async () => {
    const read = vi.fn(async () => new Blob([new Uint8Array([7])], { type: 'image/jpeg' }))
    const inliner = artworkInliner(read)
    for (let song = 1; song <= 13; song++) await inliner.load(`app://selfmp3/_media/covers/${song}.jpg`)

    expect(inliner.ready('app://selfmp3/_media/covers/1.jpg')).toBeNull()
    expect(inliner.ready('app://selfmp3/_media/covers/13.jpg')).not.toBeNull()
  })
})
