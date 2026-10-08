import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'
import type { Stats } from '@selfmp3/shared'

import { monthCard, monthCardSpoken, profileLine, profileName, profileRows } from './profile.model'

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
    expect(profileName('Xiao Zhang')).toBe('Xiao')
    expect(profileName('  ')).toBe('Profile')
    expect(profileName(null)).toBe('Profile')
  })

  it('says what the library holds, and nothing about being in step', () => {
    const base = { songs: 45, tags: 8, error: false }
    expect(profileLine(base)).toBe('45 songs · 8 tags')
    expect(profileLine({ ...base, songs: 1, tags: 1 })).toBe('1 song · 1 tag')
    expect(profileLine({ ...base, songs: undefined, tags: undefined })).toBe('')
    // A failed refetch keeps the cached library, and the line still says it failed.
    expect(profileLine({ ...base, error: true })).toBe(
      '45 songs · 8 tags · can’t reach your library',
    )
    const capped = new ApiError(502, 'cap exceeded', 'bucket_cap_exceeded')
    expect(profileLine({ ...base, error: capped })).toBe(
      '45 songs · 8 tags · storage allowance used up for today',
    )
    expect(profileLine({ songs: undefined, tags: undefined, error: true })).toBe(
      'Can’t reach your library',
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
