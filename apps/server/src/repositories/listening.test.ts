import { describe, expect, it } from 'vitest'
import {
  dayKeyBefore,
  readerZone,
  topArtists,
  wallClock,
  windowStart,
  zoneDayKey,
} from './listening.js'

describe('topArtists', () => {
  it('splits collaborations so an artist counts for every song naming them', () => {
    const top = topArtists(
      [
        { artist: 'yorushika', plays: 6, ms: 81 * 60_000 },
        { artist: 'YOASOBI', plays: 5, ms: 108 * 60_000 },
        { artist: 'Yorushika feat. suis', plays: 4, ms: 100 * 60_000 },
        { artist: '', plays: 1, ms: 3 * 60_000 },
      ],
      10,
    )
    expect(top).toEqual([
      { key: 'yorushika', plays: 10, minutes: 181 },
      { key: 'YOASOBI', plays: 5, minutes: 108 },
      { key: 'suis', plays: 4, minutes: 100 },
      { key: 'Unknown artist', plays: 1, minutes: 3 },
    ])
  })

  it('ranks after splitting, so an artist spread over many credits is not cut off', () => {
    // As written, "A & B" and "A feat. C" are each played less than D; A is played most.
    const top = topArtists(
      [
        { artist: 'D', plays: 5, ms: null },
        { artist: 'A & B', plays: 3, ms: null },
        { artist: 'A feat. C', plays: 3, ms: null },
      ],
      1,
    )
    expect(top.map(entry => entry.key)).toEqual(['A'])
  })
})

describe('topArtists with joined artists', () => {
  it('counts a joined spelling under the name shown, and a song naming both once', () => {
    const top = topArtists(
      [
        { artist: 'Yorushika', plays: 5, ms: null },
        { artist: 'ヨルシカ', plays: 2, ms: null },
        { artist: 'Yorushika, ヨルシカ', plays: 1, ms: null },
      ],
      10,
      new Map([['ヨルシカ', 'Yorushika']]),
    )
    expect(top.map(entry => [entry.key, entry.plays])).toEqual([['Yorushika', 8]])
  })
})

describe('reader zones', () => {
  it("reads a stored UTC time as the zone's wall clock", () => {
    expect(wallClock('2026-10-26 03:15:00', 'Asia/Shanghai')).toBe('2026-10-26 11:15:00')
    expect(wallClock('2026-10-26 03:15:00', 'America/Los_Angeles')).toBe('2026-10-25 20:15:00')
    expect(wallClock('2026-10-26 03:15:00', 'Asia/Kolkata')).toBe('2026-10-26 08:45:00')
  })

  it('follows a clock change inside the day it happens', () => {
    // Los Angeles springs forward at 10:00 UTC on 8 March 2026.
    expect(wallClock('2026-03-08 09:30:00', 'America/Los_Angeles')).toBe('2026-03-08 01:30:00')
    expect(wallClock('2026-03-08 10:30:00', 'America/Los_Angeles')).toBe('2026-03-08 03:30:00')
    // And the days either side keep their own offsets.
    expect(wallClock('2026-03-07 12:00:00', 'America/Los_Angeles')).toBe('2026-03-07 04:00:00')
    expect(wallClock('2026-03-09 12:00:00', 'America/Los_Angeles')).toBe('2026-03-09 05:00:00')
  })

  it("opens a window at the zone's midnight", () => {
    const now = Date.parse('2026-10-26T03:15:00Z')
    expect(zoneDayKey(now, 'Asia/Shanghai')).toBe('2026-10-26')
    expect(zoneDayKey(now, 'America/Los_Angeles')).toBe('2026-10-25')
    // Today alone, from midnight in Shanghai (16:00 UTC the day before).
    expect(windowStart(1, 'Asia/Shanghai', now)).toBe('2026-10-25 16:00:00')
    // A week back in Los Angeles: Oct 19, still on summer time (UTC-7).
    expect(windowStart(7, 'America/Los_Angeles', now)).toBe('2026-10-19 07:00:00')
    // Across the autumn change: Nov 1 opens on summer time, Nov 2 on winter.
    const later = Date.parse('2026-11-02T20:00:00Z')
    expect(windowStart(2, 'America/Los_Angeles', later)).toBe('2026-11-01 07:00:00')
    expect(windowStart(1, 'America/Los_Angeles', later)).toBe('2026-11-02 08:00:00')
  })

  it('steps day keys back across months', () => {
    expect(dayKeyBefore('2026-03-01', 1)).toBe('2026-02-28')
    expect(dayKeyBefore('2026-10-26', 0)).toBe('2026-10-26')
  })

  it("keeps a zone it knows and falls back to the server's otherwise", () => {
    const here = new Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(readerZone('Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(readerZone('Mars/Olympus_Mons')).toBe(here)
    expect(readerZone(undefined)).toBe(here)
  })
})
