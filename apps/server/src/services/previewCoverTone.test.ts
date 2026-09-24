import { describe, expect, it, vi } from 'vitest'
import type { CoverTone } from '@selfmp3/shared'
import { createLogger } from '../logger.js'
import { isCoverUrl, PreviewCoverTones } from './previewCoverTone.js'

const TONE: CoverTone = { hue: 200, chroma: 0.1 }
const COVER = 'https://yt3.googleusercontent.com/abc=w544-h544-l90-rj'

function tones(options: { status?: number; tone?: CoverTone | null } = {}) {
  const fetched: string[] = []
  const read = vi.fn(() => Promise.resolve(options.tone === undefined ? TONE : options.tone))
  const service = new PreviewCoverTones({
    logger: createLogger('silent'),
    fetch: ((url: string) => {
      fetched.push(url)
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { status: options.status ?? 200 }),
      )
    }) as typeof fetch,
    read,
  })
  return { service, fetched, read }
}

describe('isCoverUrl', () => {
  it('takes a cover from where YouTube keeps them, over https, and nothing else', () => {
    expect(isCoverUrl(COVER)).toBe(true)
    expect(isCoverUrl('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true)
    expect(isCoverUrl('http://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(false)
    expect(isCoverUrl('https://ytimg.com.evil.test/x.jpg')).toBe(false)
    expect(isCoverUrl('https://localhost:4600/api/health')).toBe(false)
    expect(isCoverUrl('not a link')).toBe(false)
  })
})

describe('PreviewCoverTones', () => {
  it('fetches the picture, reads it once, and remembers the answer', async () => {
    const { service, fetched, read } = tones()
    expect(await service.tone(COVER)).toEqual(TONE)
    expect(await service.tone(COVER)).toEqual(TONE)
    expect(fetched).toEqual([COVER])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('shares one read between asks in the same moment', async () => {
    const { service, read } = tones()
    const [a, b] = await Promise.all([service.tone(COVER), service.tone(COVER)])
    expect(a).toEqual(TONE)
    expect(b).toEqual(TONE)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('answers null for a picture it could not fetch, and asks again next time', async () => {
    const { service, fetched } = tones({ status: 404 })
    expect(await service.tone(COVER)).toBeNull()
    expect(await service.tone(COVER)).toBeNull()
    expect(fetched).toHaveLength(2)
  })
})
