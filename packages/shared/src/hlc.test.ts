import { describe, expect, it } from 'vitest'
import { HLC_PATTERN, HlcClock, formatHlc, hlcTime, hlcWins, laterHlc, parseHlc } from './hlc.js'

describe('clock stamps', () => {
  it('read back what they were made from', () => {
    const stamp = formatHlc({ ms: 1_789_000_000_123, counter: 7, device: 'web-3f9a2c1d' })
    expect(stamp).toMatch(HLC_PATTERN)
    expect(parseHlc(stamp)).toEqual({ ms: 1_789_000_000_123, counter: 7, device: 'web-3f9a2c1d' })
    expect(hlcTime(stamp)).toBe(1_789_000_000_123)
  })

  it('sort as text in time order, then by counter, then by device', () => {
    const stamps = [
      formatHlc({ ms: 2_000, counter: 0, device: 'mac-aaaa' }),
      formatHlc({ ms: 1_000, counter: 1, device: 'mac-aaaa' }),
      formatHlc({ ms: 1_000, counter: 0, device: 'web-bbbb' }),
      formatHlc({ ms: 1_000, counter: 0, device: 'mac-aaaa' }),
      formatHlc({ ms: 999, counter: 36 ** 4 - 1, device: 'zzz-zzzz' }),
    ]
    expect([...stamps].sort().map(parseHlc)).toEqual([
      { ms: 999, counter: 36 ** 4 - 1, device: 'zzz-zzzz' },
      { ms: 1_000, counter: 0, device: 'mac-aaaa' },
      { ms: 1_000, counter: 0, device: 'web-bbbb' },
      { ms: 1_000, counter: 1, device: 'mac-aaaa' },
      { ms: 2_000, counter: 0, device: 'mac-aaaa' },
    ])
  })

  it('are not mistaken for anything else', () => {
    expect(parseHlc('')).toBeNull()
    expect(parseHlc('0mfx3k2p1.0000.')).toBeNull()
    expect(parseHlc('0mfx3k2p1.000.web-3f9a')).toBeNull()
    expect(parseHlc('0MFX3K2P1.0000.web-3f9a')).toBeNull()
  })

  it('decide which change wins: the later one, and anything over nothing', () => {
    const early = formatHlc({ ms: 1_000, counter: 0, device: 'mac-aaaa' })
    const late = formatHlc({ ms: 2_000, counter: 0, device: 'mac-aaaa' })
    expect(hlcWins(late, early)).toBe(true)
    expect(hlcWins(early, late)).toBe(false)
    expect(hlcWins(early, early)).toBe(false)
    expect(hlcWins(early, undefined)).toBe(true)
    expect(hlcWins(early, null)).toBe(true)
    expect(laterHlc(early, late)).toBe(late)
    expect(laterHlc(null, early)).toBe(early)
    expect(laterHlc(undefined, undefined)).toBeNull()
  })
})

describe('a device clock', () => {
  it('follows the wall clock', () => {
    let now = 5_000
    const clock = new HlcClock('web-3f9a2c1d', { now: () => now })
    expect(parseHlc(clock.tick())).toEqual({ ms: 5_000, counter: 0, device: 'web-3f9a2c1d' })
    now = 6_000
    expect(parseHlc(clock.tick())).toEqual({ ms: 6_000, counter: 0, device: 'web-3f9a2c1d' })
  })

  it('keeps counting within one millisecond, and when the wall clock goes back', () => {
    let now = 5_000
    const clock = new HlcClock('web-3f9a2c1d', { now: () => now })
    const first = clock.tick()
    const second = clock.tick()
    now = 1_000
    const third = clock.tick()
    expect(first < second && second < third).toBe(true)
    expect(parseHlc(third)).toEqual({ ms: 5_000, counter: 2, device: 'web-3f9a2c1d' })
  })

  it('moves past a stamp from a device whose clock is ahead', () => {
    const clock = new HlcClock('web-3f9a2c1d', { now: () => 5_000 })
    const ahead = formatHlc({ ms: 90_000, counter: 3, device: 'mac-aaaa' })
    clock.observe(ahead)
    const next = clock.tick()
    expect(next > ahead).toBe(true)
    expect(parseHlc(next)).toEqual({ ms: 90_000, counter: 4, device: 'web-3f9a2c1d' })
  })

  it('ignores a stamp it has already passed, and one it cannot read', () => {
    const clock = new HlcClock('web-3f9a2c1d', { now: () => 5_000 })
    clock.observe(formatHlc({ ms: 1_000, counter: 0, device: 'mac-aaaa' }))
    clock.observe('not a stamp')
    expect(parseHlc(clock.tick())).toEqual({ ms: 5_000, counter: 0, device: 'web-3f9a2c1d' })
  })

  it('carries on after a restart from the last stamp it made or saw', () => {
    const before = new HlcClock('web-3f9a2c1d', { now: () => 9_000 })
    before.tick()
    before.tick()
    const after = new HlcClock('web-3f9a2c1d', { now: () => 1_000, last: before.last })
    expect(parseHlc(after.tick())).toEqual({ ms: 9_000, counter: 2, device: 'web-3f9a2c1d' })
    expect(new HlcClock('web-3f9a2c1d').last).toBeNull()
  })

  it('moves to the next millisecond when the counter runs out', () => {
    const clock = new HlcClock('web-3f9a2c1d', {
      now: () => 5_000,
      last: formatHlc({ ms: 5_000, counter: 36 ** 4 - 1, device: 'web-3f9a2c1d' }),
    })
    expect(parseHlc(clock.tick())).toEqual({ ms: 5_001, counter: 0, device: 'web-3f9a2c1d' })
  })

  it('refuses a device id that could not appear in a stamp', () => {
    expect(() => new HlcClock('Web 1')).toThrow()
  })
})
