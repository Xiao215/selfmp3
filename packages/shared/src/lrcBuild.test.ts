import { describe, expect, it } from 'vitest'
import { parseLyrics } from './lrc.js'
import { buildLrc, formatLrcTimestamp, splitPlainLyrics } from './lrcBuild.js'

describe('formatLrcTimestamp', () => {
  it('writes mm:ss.xx', () => {
    expect(formatLrcTimestamp(0)).toBe('[00:00.00]')
    expect(formatLrcTimestamp(83.456)).toBe('[01:23.46]')
    expect(formatLrcTimestamp(600)).toBe('[10:00.00]')
  })

  it('rounds to centiseconds without producing 60 seconds', () => {
    expect(formatLrcTimestamp(59.999)).toBe('[01:00.00]')
    expect(formatLrcTimestamp(0.005)).toBe('[00:00.01]')
  })

  it('clamps nonsense to zero', () => {
    expect(formatLrcTimestamp(-3)).toBe('[00:00.00]')
    expect(formatLrcTimestamp(Number.NaN)).toBe('[00:00.00]')
  })
})

describe('buildLrc', () => {
  it('emits tapped lines in time order and drops untapped ones', () => {
    const lrc = buildLrc([
      { time: 5.2, text: 'second' },
      { time: 1.0, text: 'first' },
      { time: null, text: 'never tapped' },
    ])
    expect(lrc).toBe('[00:01.00]first\n[00:05.20]second\n')
  })

  it('round-trips through the parser with the same times and text', () => {
    const lines = [
      { time: 1.0, text: '夜空慢慢暗下来' },
      { time: 5.0, text: '星星一颗颗亮起来' },
      { time: 9.37, text: 'la la' },
    ]
    const parsed = parseLyrics(buildLrc(lines, { title: '夜空', artist: '李晨曦' }))
    expect(parsed.synced).toBe(true)
    if (!parsed.synced) return
    expect(parsed.lines.map(line => line.text)).toEqual(lines.map(line => line.text))
    expect(parsed.lines.map(line => line.time)).toEqual([1, 5, 9.37])
  })

  it('writes metadata tags first', () => {
    const lrc = buildLrc([{ time: 0, text: 'x' }], { title: 'T', artist: 'A' })
    expect(lrc.split('\n').slice(0, 2)).toEqual(['[ti:T]', '[ar:A]'])
  })

  it('is empty when nothing was tapped', () => {
    expect(buildLrc([{ time: null, text: 'a' }])).toBe('')
  })

  it('keeps ties in their original order', () => {
    const lrc = buildLrc([
      { time: 2, text: 'a' },
      { time: 2, text: 'b' },
    ])
    expect(lrc).toBe('[00:02.00]a\n[00:02.00]b\n')
  })
})

describe('splitPlainLyrics', () => {
  it('strips existing timestamps and collapses blank runs', () => {
    expect(splitPlainLyrics('[00:01.00]one\n\n\n[00:02.00] two \nthree')).toEqual([
      'one',
      '',
      'two',
      'three',
    ])
  })

  it('drops leading and trailing blank lines', () => {
    expect(splitPlainLyrics('\n\nfirst')).toEqual(['first'])
    expect(splitPlainLyrics('first\nsecond\n')).toEqual(['first', 'second'])
  })
})
