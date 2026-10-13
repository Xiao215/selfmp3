import { describe, expect, it } from 'vitest'
import {
  BUCKET_CAP_CODE,
  DOORMAN_PATHS,
  bucketCallOf,
  parseDoormanRefusal,
  refusalWords,
  signInStartUrl,
} from './doormanWire.js'

describe('parseDoormanRefusal', () => {
  it('reads the doorman’s two fields, from text or from JSON already parsed', () => {
    const body = { error: 'Backblaze says “Transaction cap exceeded”', code: BUCKET_CAP_CODE }
    expect(parseDoormanRefusal(JSON.stringify(body))).toEqual(body)
    expect(parseDoormanRefusal(body)).toEqual(body)
  })

  it('is null for anything else', () => {
    for (const body of ['', '<html>502</html>', '{"error":"no code"}', '{"code":1}', null, 7]) {
      expect(parseDoormanRefusal(body)).toBeNull()
    }
  })
})

describe('refusalWords', () => {
  it('says the doorman’s words, or the page’s without its tags', () => {
    expect(refusalWords('{"error":" no bucket ","code":"no_storage"}')).toBe('no bucket')
    expect(refusalWords('<h1>Error 1027</h1><p>plan limits</p>')).toBe('Error 1027 plan limits')
    expect(refusalWords('x'.repeat(500), 10)).toBe('x'.repeat(10))
    expect(refusalWords('')).toBe('')
  })
})

describe('DOORMAN_PATHS', () => {
  it('encodes each part of a key and keeps the slashes', () => {
    expect(DOORMAN_PATHS.file('snapshots/20260911T142205123Z-mac-3f9a1c2e.json')).toBe(
      '/v1/files/snapshots/20260911T142205123Z-mac-3f9a1c2e.json',
    )
    expect(DOORMAN_PATHS.file('log/a b/1.json')).toBe('/v1/files/log/a%20b/1.json')
  })

  it('builds a listing’s query, leaving out a cursor it does not have', () => {
    expect(DOORMAN_PATHS.listing('log/')).toBe('/v1/list?prefix=log%2F')
    expect(DOORMAN_PATHS.listing('', 'next&page')).toBe('/v1/list?prefix=&cursor=next%26page')
  })

  it('carries a member’s token on a room’s paths', () => {
    expect(DOORMAN_PATHS.room('KQ7482', '/socket', 'f'.repeat(32))).toBe(
      `/v1/rooms/KQ7482/socket?t=${'f'.repeat(32)}`,
    )
    expect(DOORMAN_PATHS.room('KQ7482', '/join')).toBe('/v1/rooms/KQ7482/join')
  })
})

describe('bucketCallOf', () => {
  /*
   * The replica's cap hold is keyed off this. It used to test the paths with
   * a `startsWith('/v1/list')` of its own, which a renamed route would have
   * quietly switched off; now the requests are built from the same paths.
   */
  it('names the reads and listings the cap counts, and nothing else', () => {
    expect(bucketCallOf('GET', DOORMAN_PATHS.file('audio/a.m4a'))).toBe('read')
    expect(bucketCallOf('GET', DOORMAN_PATHS.listing('log/'))).toBe('list')
    expect(bucketCallOf('PUT', DOORMAN_PATHS.file('log/mac-1/1.json'))).toBeNull()
    expect(bucketCallOf('GET', DOORMAN_PATHS.me)).toBeNull()
    expect(bucketCallOf('GET', DOORMAN_PATHS.changes)).toBeNull()
  })
})

describe('signInStartUrl', () => {
  it('names the attempt and, where there is one, the way back', () => {
    expect(signInStartUrl('https://doorman.example/', 'ab'.repeat(16), 'selfmp3://welcome')).toBe(
      `https://doorman.example/v1/auth/start?attempt=${'ab'.repeat(16)}` +
        '&return=selfmp3%3A%2F%2Fwelcome',
    )
    expect(signInStartUrl('https://doorman.example', 'cd'.repeat(16), null)).toBe(
      `https://doorman.example/v1/auth/start?attempt=${'cd'.repeat(16)}`,
    )
  })
})
