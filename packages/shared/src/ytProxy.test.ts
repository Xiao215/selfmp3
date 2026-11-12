import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  base64ToBytes,
  bytesToBase64,
  isYtProxyPage,
  isYtProxyUrl,
  sapisidHash,
  signsIn,
  YtProxyPageMessageSchema,
} from './ytProxy.js'

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

describe('signsIn', () => {
  it('signs in the player request and nothing else', () => {
    expect(signsIn('https://www.youtube.com/youtubei/v1/player?prettyPrint=false')).toBe(true)
    expect(signsIn('https://music.youtube.com/youtubei/v1/player')).toBe(true)
    for (const url of [
      'https://www.youtube.com/youtubei/v1/like/like',
      'https://www.youtube.com/youtubei/v1/subscription/subscribe',
      'https://www.youtube.com/youtubei/v1/next',
      'https://www.youtube.com/youtubei/v1/player/heartbeat',
      'https://rr1---sn-x.googlevideo.com/videoplayback?itag=140',
      'https://www.youtube.com.evil.example/youtubei/v1/player',
    ]) {
      expect(signsIn(url)).toBe(false)
    }
  })
})

describe('sapisidHash', () => {
  it('is the SHA-1 of the time, the cookie and YouTube’s origin, as YouTube makes it', async () => {
    const expected = createHash('sha1')
      .update('1700000000 abc/DEF https://www.youtube.com')
      .digest('hex')
    expect(await sapisidHash('abc/DEF', 1_700_000_000)).toBe(`SAPISIDHASH 1700000000_${expected}`)
  })
})

describe('isYtProxyPage', () => {
  it('lets in the app’s own pages, not the rest of the site it is on', () => {
    expect(isYtProxyPage('https://xiao215.github.io/selfmp3/import/review')).toBe(true)
    expect(isYtProxyPage('http://localhost:4601/import')).toBe(true)
    expect(isYtProxyPage('https://xiao215.github.io/other/')).toBe(false)
    expect(isYtProxyPage('https://xiao215.github.io/selfmp3-evil/')).toBe(false)
    expect(isYtProxyPage('http://localhost:4603/')).toBe(false)
  })
})
