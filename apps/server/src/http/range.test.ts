import { describe, expect, it } from 'vitest'
import { parseRange } from './range.js'

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
