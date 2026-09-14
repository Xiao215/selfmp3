import { describe, expect, it } from 'vitest'
import { answerRange, parseRange } from './range.js'

/**
 * Range parsing is the single most bug-prone piece of the streaming path, and
 * getting it wrong breaks seeking on the phone in ways that are painful to
 * debug from a browser. So it gets the most thorough test in the server.
 */
describe('parseRange', () => {
  const SIZE = 1000

  it('returns null when there is no Range header', () => {
    expect(parseRange(undefined, SIZE)).toBeNull()
  })

  it('parses a closed range', () => {
    expect(parseRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 })
    expect(parseRange('bytes=500-999', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('parses an open-ended range as running to the end of the file', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('parses a suffix range as the final N bytes', () => {
    expect(parseRange('bytes=-500', SIZE)).toEqual({ start: 500, end: 999 })
  })

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the file rather than rejecting it', () => {
    // Safari does this routinely; rejecting it would break playback outright.
    expect(parseRange('bytes=900-99999', SIZE)).toEqual({ start: 900, end: 999 })
  })

  it('rejects a start past the end of the file', () => {
    expect(parseRange('bytes=1000-', SIZE)).toBe('unsatisfiable')
    expect(parseRange('bytes=2000-3000', SIZE)).toBe('unsatisfiable')
  })

  it('rejects an inverted range', () => {
    expect(parseRange('bytes=500-100', SIZE)).toBe('unsatisfiable')
  })

  it('rejects a zero-length suffix', () => {
    expect(parseRange('bytes=-0', SIZE)).toBe('unsatisfiable')
  })

  it('ignores malformed headers instead of throwing', () => {
    expect(parseRange('bytes=abc-def', SIZE)).toBeNull()
    expect(parseRange('items=0-10', SIZE)).toBeNull()
    expect(parseRange('bytes=', SIZE)).toBeNull()
    expect(parseRange('bytes=-', SIZE)).toBeNull()
  })

  it('does not support multi-range requests', () => {
    // Returning null falls back to sending the whole file, which is correct
    // and far better than serving the wrong bytes.
    expect(parseRange('bytes=0-99,200-299', SIZE)).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=0-99  ', SIZE)).toEqual({ start: 0, end: 99 })
  })

  it('handles a single-byte file', () => {
    expect(parseRange('bytes=0-', 1)).toEqual({ start: 0, end: 0 })
  })
})

describe('answerRange', () => {
  const base = {
    sizeBytes: 1000,
    mime: 'audio/mp4',
    etag: '"abc"',
    lastModified: new Date('2026-09-14T08:00:00Z'),
  }

  it('answers 200 with the whole file when nothing was asked for', () => {
    const answer = answerRange({ ...base, rangeHeader: undefined })
    expect(answer.status).toBe(200)
    expect(answer.start).toBe(0)
    expect(answer.end).toBe(999)
    expect(answer.length).toBe(1000)
    expect(answer.headers['Content-Length']).toBe('1000')
    expect(answer.headers['Content-Range']).toBeUndefined()
  })

  it('answers 206 for a range, with the offsets HTTP spells', () => {
    const answer = answerRange({ ...base, rangeHeader: 'bytes=100-199' })
    expect(answer.status).toBe(206)
    expect(answer.start).toBe(100)
    expect(answer.end).toBe(199)
    expect(answer.length).toBe(100)
    expect(answer.headers['Content-Range']).toBe('bytes 100-199/1000')
    expect(answer.headers['Content-Length']).toBe('100')
  })

  it('answers the open-ended range every media element opens with', () => {
    const answer = answerRange({ ...base, rangeHeader: 'bytes=0-' })
    expect(answer.status).toBe(206)
    expect(answer.headers['Content-Range']).toBe('bytes 0-999/1000')
  })

  it('clamps a range that ends past the file', () => {
    const answer = answerRange({ ...base, rangeHeader: 'bytes=900-5000' })
    expect(answer.end).toBe(999)
    expect(answer.headers['Content-Range']).toBe('bytes 900-999/1000')
  })

  it('answers 416 for a range that starts past the file', () => {
    const answer = answerRange({ ...base, rangeHeader: 'bytes=2000-' })
    expect(answer.status).toBe(416)
    expect(answer.length).toBe(0)
    expect(answer.headers['Content-Range']).toBe('bytes */1000')
  })

  it('carries the validators and the cache rule whatever the answer', () => {
    for (const rangeHeader of [undefined, 'bytes=0-9', 'bytes=9999-']) {
      const answer = answerRange({ ...base, rangeHeader })
      expect(answer.headers['Accept-Ranges']).toBe('bytes')
      expect(answer.headers['Content-Type']).toBe('audio/mp4')
      expect(answer.headers['ETag']).toBe('"abc"')
      expect(answer.headers['Cache-Control']).toBe('private, max-age=31536000, immutable')
      expect(answer.headers['Last-Modified']).toBe('Mon, 14 Sep 2026 08:00:00 GMT')
    }
  })

  it('asks for no bytes from an empty file, rather than 0 to -1', () => {
    const answer = answerRange({ ...base, sizeBytes: 0, rangeHeader: undefined })
    expect(answer.length).toBe(0)
  })
})
