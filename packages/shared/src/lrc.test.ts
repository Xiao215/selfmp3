import { describe, expect, it } from 'vitest'
import { activeLineIndex, isSynced, parseLyrics, type SyncedLine } from './lrc.js'

// Fixtures use placeholder text so the test suite carries no third-party content.
const SYNCED = [
  '[ar:Placeholder Artist]',
  '[00:12.50]line one',
  '[00:18.00]line two',
  '[01:05.25]line three',
].join('\n')

describe('parseLyrics', () => {
  it('parses timestamps into seconds', () => {
    const parsed = parseLyrics(SYNCED)
    expect(parsed.synced).toBe(true)
    if (!parsed.synced) return
    expect(parsed.lines).toEqual([
      { time: 12.5, text: 'line one' },
      { time: 18, text: 'line two' },
      { time: 65.25, text: 'line three' },
    ])
  })

  it('drops metadata tags', () => {
    const parsed = parseLyrics(SYNCED)
    if (!parsed.synced) throw new Error('expected synced')
    expect(parsed.lines.some(l => l.text.includes('Placeholder Artist'))).toBe(false)
  })

  it('expands a line carrying several timestamps', () => {
    const parsed = parseLyrics('[00:10.00][01:10.00]chorus\n[00:20.00]verse')
    if (!parsed.synced) throw new Error('expected synced')
    expect(parsed.lines.map(l => l.time)).toEqual([10, 20, 70])
    expect(parsed.lines[0]?.text).toBe('chorus')
    expect(parsed.lines[2]?.text).toBe('chorus')
  })

  it('accepts colon-separated and millisecond fractions', () => {
    const parsed = parseLyrics('[00:05:50]a\n[00:06.125]b')
    if (!parsed.synced) throw new Error('expected synced')
    expect(parsed.lines[0]?.time).toBeCloseTo(5.5, 5)
    expect(parsed.lines[1]?.time).toBeCloseTo(6.125, 5)
  })

  it('treats a single stray timestamp as plain text', () => {
    const parsed = parseLyrics('[00:01.00]only one\nnot timed')
    expect(parsed.synced).toBe(false)
  })

  it('falls back to plain lines and trims surrounding blanks', () => {
    const parsed = parseLyrics('\n\nfirst\n\nsecond\n\n')
    expect(parsed.synced).toBe(false)
    if (parsed.synced) return
    expect(parsed.lines).toEqual(['first', '', 'second'])
  })

  it('handles an empty file', () => {
    const parsed = parseLyrics('')
    expect(parsed.synced).toBe(false)
    if (parsed.synced) return
    expect(parsed.lines).toEqual([])
  })
})

describe('activeLineIndex', () => {
  const lines: SyncedLine[] = [
    { time: 10, text: 'a' },
    { time: 20, text: 'b' },
    { time: 30, text: 'c' },
  ]

  it('returns -1 before the first line', () => {
    expect(activeLineIndex(lines, 0, 0)).toBe(-1)
  })

  it('finds the line in effect at a given time', () => {
    expect(activeLineIndex(lines, 10, 0)).toBe(0)
    expect(activeLineIndex(lines, 19.9, 0)).toBe(0)
    expect(activeLineIndex(lines, 20, 0)).toBe(1)
    expect(activeLineIndex(lines, 999, 0)).toBe(2)
  })

  it('applies the lead so lines light up slightly early', () => {
    expect(activeLineIndex(lines, 9.8, 0.25)).toBe(0)
    expect(activeLineIndex(lines, 9.5, 0.25)).toBe(-1)
  })

  it('copes with an empty list', () => {
    expect(activeLineIndex([], 5)).toBe(-1)
  })
})

describe('isSynced', () => {
  it('distinguishes timed from untimed text', () => {
    expect(isSynced(SYNCED)).toBe(true)
    expect(isSynced('just\nsome\nwords')).toBe(false)
  })
})
