import { describe, expect, it } from 'vitest'
import { EMPTY_SMART_RULES, type Playlist, type SmartRules } from '@selfmp3/shared'

import {
  copyName,
  madeFrom,
  newPlaylist,
  pinnedPlaylists,
  playlistsToAddTo,
  sortPlaylists,
} from './playlists.model'

const playlist = (name: string, patch: Partial<Playlist> = {}): Playlist => ({
  id: name.length,
  name,
  description: '',
  kind: 'manual',
  rules: null,
  songCount: 0,
  totalDuration: 0,
  pinned: false,
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
  lastPlayedAt: null,
  ...patch,
})

const names = (list: readonly Playlist[]): string[] => list.map(p => p.name)

describe('the order playlists appear in', () => {
  it('puts the most recently played first', () => {
    const ordered = sortPlaylists(
      [
        playlist('Morning', { lastPlayedAt: '2026-09-01 08:00:00' }),
        playlist('Evening', { lastPlayedAt: '2026-09-12 20:00:00' }),
        playlist('Night'),
      ],
      'recent',
    )
    expect(names(ordered)).toEqual(['Evening', 'Morning', 'Night'])
  })

  it('counts making a playlist as playing it, so a new one is not buried', () => {
    const ordered = sortPlaylists(
      [
        playlist('Old favourite', { lastPlayedAt: '2026-09-10 08:00:00' }),
        playlist('Just made', { createdAt: '2026-09-13 06:00:00' }),
      ],
      'recent',
    )
    expect(names(ordered)).toEqual(['Just made', 'Old favourite'])
  })

  it('compares a bucket’s ISO dates with the server’s spaced ones fairly', () => {
    const ordered = sortPlaylists(
      [
        playlist('Server', { lastPlayedAt: '2026-09-12 23:00:00' }),
        playlist('Bucket', { createdAt: '2026-09-12T22:00:00.000Z' }),
      ],
      'recent',
    )
    expect(names(ordered)).toEqual(['Server', 'Bucket'])
  })

  it('does not lift pinned playlists above the rest', () => {
    const ordered = sortPlaylists(
      [playlist('Zebra', { pinned: true }), playlist('Aardvark')],
      'name',
    )
    expect(names(ordered)).toEqual(['Aardvark', 'Zebra'])
  })

  it('sorts by when each was made, newest first', () => {
    const ordered = sortPlaylists(
      [
        playlist('First', { createdAt: '2026-01-01 00:00:00' }),
        playlist('Second', { createdAt: '2026-02-01 00:00:00' }),
      ],
      'added',
    )
    expect(names(ordered)).toEqual(['Second', 'First'])
  })

  it('leaves the caller’s array alone', () => {
    const given = [playlist('B'), playlist('A')]
    sortPlaylists(given, 'name')
    expect(names(given)).toEqual(['B', 'A'])
  })
})

describe('pinned playlists', () => {
  it('are the pinned ones, by name, however recently each was played', () => {
    const pinned = pinnedPlaylists([
      playlist('Road trip', { pinned: true, lastPlayedAt: '2026-09-13 10:00:00' }),
      playlist('Unpinned'),
      playlist('Evening', { pinned: true }),
    ])
    expect(names(pinned)).toEqual(['Evening', 'Road trip'])
  })
})

describe('the playlists a song can be added to', () => {
  it('leaves out live playlists, and lists pinned ones first', () => {
    const rules: SmartRules = EMPTY_SMART_RULES
    const choices = playlistsToAddTo([
      playlist('Alpha'),
      playlist('Long songs', { kind: 'live', rules, pinned: true }),
      playlist('Zulu', { pinned: true }),
    ])
    expect(names(choices)).toEqual(['Zulu', 'Alpha'])
  })
})

describe('making a playlist', () => {
  it('gives a live playlist the rules it starts from, and a playlist none', () => {
    expect(newPlaylist('live', 'Chill')).toEqual({
      name: 'Chill',
      description: '',
      kind: 'live',
      rules: EMPTY_SMART_RULES,
    })
    const rules: SmartRules = { ...EMPTY_SMART_RULES, orderBy: 'duration' }
    expect(newPlaylist('live', 'Long', { rules })?.rules).toBe(rules)
    expect(newPlaylist('manual', 'Evening', { rules })?.rules).toBeNull()
  })

  it('trims the name, and makes nothing of a name that is only space', () => {
    expect(newPlaylist('manual', '  Road trip  ')?.name).toBe('Road trip')
    expect(newPlaylist('manual', '   ')).toBeNull()
  })

  it('says how a smart playlist was made', () => {
    expect(madeFrom('Most played', new Date(2026, 8, 13))).toBe('Made from Most played · 13 Sep')
  })

  it('names a copy so it never takes an existing name', () => {
    expect(copyName('Evening', ['Evening'])).toBe('Evening copy')
    expect(copyName('Evening', ['Evening', 'Evening copy', 'Evening copy 2'])).toBe(
      'Evening copy 3',
    )
  })
})
