import { describe, expect, it } from 'vitest'
import type { Stats } from '@selfmp3/shared'

import {
  accountInitials,
  monthCard,
  monthCardSpoken,
  profileLine,
  profileName,
  profileRows,
} from './profile.model'

const stats: Stats = {
  range: '30d',
  totals: {
    plays: 128,
    minutes: 372,
    songsPlayed: 30,
    librarySize: 45,
    libraryMinutes: 180,
    neverPlayed: 4,
  },
  streakDays: 9,
  longestStreakDays: 12,
  daily: [],
  hourly: [
    { hour: 9, plays: 3 },
    { hour: 23, plays: 16 },
  ],
  topArtists: [],
  topTags: [],
  topSongs: [
    { songId: 21, title: 'ノーチラス', artist: 'ヨルシカ', hasArt: true, plays: 14, minutes: 60 },
  ],
}

describe('the Profile page', () => {
  it('lists Import, Report and Settings, and nothing else', () => {
    const rows = profileRows({ place: 'phone' })
    expect(rows.map(row => [row.id, row.label, row.href])).toEqual([
      ['import', 'Import', '/import'],
      ['report', 'Report', '/stats/report'],
      ['settings', 'Settings', '/settings'],
    ])
    expect(rows[2]?.hint).toBe('Account, look, on this phone, devices')
    expect(profileRows({ place: 'computer' })[2]?.hint).toBe(
      'Account, look, on this computer, devices',
    )
  })

  it('uses the account’s first name when there is one, and the page’s when not', () => {
    expect(profileName('Xiao Zhang')).toEqual({ name: 'Xiao', initial: 'X' })
    expect(profileName('  ')).toEqual({ name: 'Profile', initial: null })
    expect(profileName(null)).toEqual({ name: 'Profile', initial: null })
  })

  it('says what the library holds, then whether this device is in step with it', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    const base = { songs: 45, tags: 8, pending: false, error: false, fromCloud: false, now }
    expect(profileLine({ ...base, syncedAt: now.getTime() - 4 * 60_000 })).toBe(
      '45 songs · 8 tags · synced 4m ago',
    )
    expect(profileLine({ ...base, songs: 1, tags: 1, syncedAt: now.getTime() })).toBe(
      '1 song · 1 tag · synced just now',
    )
    expect(
      profileLine({ ...base, songs: undefined, tags: undefined, pending: true, syncedAt: 0 }),
    ).toBe('connecting…')
    // A failed refetch keeps the cached library, so the error wins over the time.
    expect(profileLine({ ...base, error: true, fromCloud: true, syncedAt: now.getTime() })).toBe(
      '45 songs · 8 tags · can’t reach the cloud',
    )
  })

  it('makes this month one card: listened, plays, streak, and on repeat', () => {
    const card = monthCard(stats)
    expect(card).toEqual({
      listened: '6h 12',
      plays: '128',
      streak: '9',
      streakUnit: 'days',
      onRepeat: { songId: 21, title: 'ノーチラス' },
      when: 'Night owl · most at 11pm',
    })
    expect(monthCardSpoken(card)).toBe(
      'Stats. Last 30 days: 6h 12 listened, 128 plays, a streak of 9 days, on repeat: ノーチラス',
    )
  })

  it('says nothing it does not know yet', () => {
    // A cloud library that has not reached its server knows no numbers. The
    // card is still a way to Stats, which explains why it is empty.
    expect(monthCard(undefined)).toBeNull()
    expect(monthCardSpoken(null)).toBe('Stats')
    const quiet = monthCard({ ...stats, topSongs: [], hourly: [], streakDays: 1 })
    expect(quiet).toMatchObject({ onRepeat: null, when: null, streakUnit: 'day' })
  })
})

/**
 * What the round mark falls back to without a picture, the way every other
 * app does it: it has to read as a person, not a puzzle.
 */
describe('accountInitials', () => {
  const named = (name: string | null): string | null =>
    accountInitials({ name, email: 'xiao@example.com' })

  it('takes one letter from each of the first two words', () => {
    expect(named('Xiao Zhang')).toBe('XZ')
    expect(named('Ada')).toBe('A')
    // A middle name is a third word; two letters is the shape of the mark.
    expect(named('Ada Byron Lovelace')).toBe('AB')
    expect(named('  yuki  tanaka ')).toBe('YT')
    expect(named('ヨルシカ')).toBe('ヨ')
  })

  it('falls back to the address, then to nothing', () => {
    expect(named(null)).toBe('X')
    expect(named('   ')).toBe('X')
    expect(accountInitials({ name: null, email: '' })).toBeNull()
    expect(accountInitials(null)).toBeNull()
  })
})
