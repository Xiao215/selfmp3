import { describe, expect, it } from 'vitest'
import type { ApiTransport } from '../platform.js'
import { createMediaUrl } from './media.js'

/** A phone's transport: an absolute address, and a token media links must carry. */
const phone: ApiTransport = {
  url: path => `https://server.test${path}`,
  headers: () => ({ Authorization: 'Bearer secret' }),
  mediaParams: () => ({ token: 'secret' }),
}

/** A browser's: its own origin, and nothing to carry. */
const browser: ApiTransport = {
  url: path => path,
  headers: () => ({}),
}

describe('createMediaUrl', () => {
  it('sends a stream with the copy it wants and the token', () => {
    expect(createMediaUrl(phone).stream(7, 'r2')).toBe(
      'https://server.test/api/stream/7?v=r2&token=secret',
    )
    expect(createMediaUrl(browser).stream(7)).toBe('/api/stream/7')
  })

  it('carries the token on a preview too, since the player cannot send a header', () => {
    const track = 'https://music.youtube.com/watch?v=abc'
    expect(createMediaUrl(phone).importListen(track)).toBe(
      `https://server.test/api/import/listen?url=${encodeURIComponent(track)}&token=secret`,
    )
    expect(createMediaUrl(browser).importListen(track)).toBe(
      `/api/import/listen?url=${encodeURIComponent(track)}`,
    )
  })
})
