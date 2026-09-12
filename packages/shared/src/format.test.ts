import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatDuration,
  formatLongDuration,
  formatRelative,
  hueFromString,
  joinWithAnd,
  sanitizeFilename,
} from './format.js'

describe('formatDuration', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(254)).toBe('4:14')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3801)).toBe('1:03:21')
  })

  it('degrades safely on junk input', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('formatLongDuration', () => {
  it('reads naturally at each magnitude', () => {
    expect(formatLongDuration(0)).toBe('0 min')
    expect(formatLongDuration(90)).toBe('2 min')
    expect(formatLongDuration(3600)).toBe('1 hr')
    expect(formatLongDuration(4320)).toBe('1 hr 12 min')
  })
})

describe('formatBytes', () => {
  it('picks sensible units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
    expect(formatBytes(3_221_225_472)).toBe('3 GB')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-07-29T12:00:00Z')

  it('handles the null case', () => {
    expect(formatRelative(null, now)).toBe('never')
  })

  it('bucketises recent times', () => {
    expect(formatRelative('2026-07-29T11:59:30Z', now)).toBe('just now')
    expect(formatRelative('2026-07-29T11:30:00Z', now)).toBe('30m ago')
    expect(formatRelative('2026-07-29T08:00:00Z', now)).toBe('4h ago')
    expect(formatRelative('2026-07-27T12:00:00Z', now)).toBe('2d ago')
  })

  it('accepts the SQLite datetime format', () => {
    expect(formatRelative('2026-07-29 11:30:00', now)).toBe('30m ago')
  })
})

describe('sanitizeFilename', () => {
  it('removes characters that break filesystems', () => {
    expect(sanitizeFilename('AC/DC: Back? *In* Black')).toBe('ACDC Back In Black')
  })

  it('keeps non-latin scripts intact', () => {
    expect(sanitizeFilename('李晨曦 - 夜空')).toBe('李晨曦 - 夜空')
  })

  it('refuses to produce a dotfile', () => {
    expect(sanitizeFilename('...hidden')).toBe('hidden')
    // A space in front used to carry the dot past the guard, and the trim
    // afterwards turned what was left back into a dotfile.
    expect(sanitizeFilename(' .hidden')).toBe('hidden')
    expect(sanitizeFilename('\t. hidden')).toBe('hidden')
  })

  it('truncates long names', () => {
    expect(sanitizeFilename('a'.repeat(300)).length).toBe(120)
  })
})

describe('hueFromString', () => {
  it('is deterministic and in range', () => {
    const hue = hueFromString('chill')
    expect(hue).toBe(hueFromString('chill'))
    expect(hue).toBeGreaterThanOrEqual(0)
    expect(hue).toBeLessThan(360)
  })
})

describe('joinWithAnd', () => {
  it('reads like a sentence', () => {
    expect(joinWithAnd([])).toBe('')
    expect(joinWithAnd(['a'])).toBe('a')
    expect(joinWithAnd(['a', 'b'])).toBe('a and b')
    expect(joinWithAnd(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
