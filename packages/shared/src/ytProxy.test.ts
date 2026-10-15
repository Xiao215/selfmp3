import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, isYtProxyUrl, YtProxyPageMessageSchema } from './ytProxy.js'

describe('isYtProxyUrl', () => {
  it.each([
    'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/youtubei/v1/browse',
    'https://youtubei.googleapis.com/youtubei/v1/player',
    'https://www.youtube.com/s/player/ec429320/player_ias.vflset/en_US/base.js',
    'https://www.youtube.com/api/jnn/v1/GenerateIT',
    'https://rr3---sn-a5mekn6d.googlevideo.com/videoplayback?expire=1&itag=140&range=0-1',
    'https://www.google.com/js/th/abc123.js',
  ])('carries %s', url => {
    expect(isYtProxyUrl(url)).toBe(true)
  })

  it.each([
    // Not YouTube.
    'https://example.com/',
    'https://www.google.com/search?q=x',
    'https://accounts.google.com/',
    // Looks like YouTube and is not.
    'https://www.youtube.com.evil.example/',
    'https://evilgooglevideo.com/videoplayback',
    'https://googlevideo.com.evil.example/',
    // Not over https, or not to the usual port, or carrying a login.
    'http://www.youtube.com/',
    'https://www.youtube.com:8443/',
    'https://user:pass@www.youtube.com/',
    'not a url',
  ])('refuses %s', url => {
    expect(isYtProxyUrl(url)).toBe(false)
  })
})

describe('base64', () => {
  it('round-trips every byte value, past one slice', () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('round-trips nothing', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })
})

describe('YtProxyPageMessageSchema', () => {
  it('refuses a method the carrier has no use for', () => {
    const message = { type: 'request', id: 1, url: 'https://www.youtube.com/', headers: [] }
    expect(
      YtProxyPageMessageSchema.safeParse({ ...message, method: 'DELETE', body: null }).success,
    ).toBe(false)
    expect(
      YtProxyPageMessageSchema.safeParse({ ...message, method: 'POST', body: null }).success,
    ).toBe(true)
  })
})
