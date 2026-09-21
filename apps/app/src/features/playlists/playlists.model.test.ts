import { describe, expect, it } from 'vitest'
import { EMPTY_SMART_RULES, type Playlist, type SmartRules } from '@selfmp3/shared'

import {
  copyName,
  listedPlaylists,
  newPlaylist,
  playlistHeadLine,
  playlistsSubline,
  playlistsToAddTo,
  playlistTileLine,
  relativeDay,
  sortPlaylists,
} from './playlists.model'

/** Friday 18 September 2026, mid-morning where the test runs. */
const NOW = new Date(2026, 8, 18, 10, 0, 0)
/** A local time as the server writes it: UTC, no zone. */
const server = (date: Date): string => date.toISOString().slice(0, 19).replace('T', ' ')

describe('a day as a person says it', () => {
  it('names the days of this week, then weeks, months and years', () => {
    const at = (month: number, day: number, hour = 12): string =>
      server(new Date(2026, month, day, hour))
    expect(relativeDay(at(8, 18, 8), NOW)).toBe('today')
    expect(relativeDay(at(8, 17), NOW)).toBe('yesterday')
    expect(relativeDay(at(8, 15), NOW)).toBe('Tuesday')
    expect(relativeDay(at(8, 11), NOW)).toBe('last week')
    expect(relativeDay(at(8, 1), NOW)).toBe('2 weeks ago')
    expect(relativeDay(at(7, 25), NOW)).toBe('3 weeks ago')
    expect(relativeDay(at(7, 10), NOW)).toBe('last month')
    expect(relativeDay(at(3, 1), NOW)).toBe('5 months ago')
    expect(relativeDay(server(new Date(2025, 5, 1)), NOW)).toBe('last year')
    expect(relativeDay(server(new Date(2022, 5, 1)), NOW)).toBe('4 years ago')
  })

  it('counts calendar days, so last night is yesterday however few hours ago', () => {
    expect(relativeDay(server(new Date(2026, 8, 17, 23, 30)), NOW)).toBe('yesterday')
  })

  it('reads a bucket’s ISO as well as the server’s stamp, and a future one as today', () => {
    expect(relativeDay(new Date(2026, 8, 17, 12).toISOString(), NOW)).toBe('yesterday')
    expect(relativeDay(server(new Date(2026, 8, 20)), NOW)).toBe('today')
    expect(relativeDay('not a date', NOW)).toBeNull()
  })
})

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

describe('the lines a playlist is described by', () => {
  it('gives a tile its songs and the day it was last played', () => {
    const played = playlist('Evening', {
      songCount: 5,
      lastPlayedAt: server(new Date(2026, 8, 17, 21)),
    })
    expect(playlistTileLine(played, NOW)).toBe('5 songs · yesterday')
  })

  it('falls back to the day it was made when it was never played', () => {
    const made = playlist('New', { songCount: 1, createdAt: server(new Date(2026, 8, 15, 12)) })
    expect(playlistTileLine(made, NOW)).toBe('1 song · Tuesday')
  })

  it('gives the page its songs, length and last play, and leaves out a play that never was', () => {
    expect(playlistHeadLine(5, 1080, server(new Date(2026, 8, 17, 21)), NOW)).toBe(
      '5 songs · 18 min · played yesterday',
    )
    expect(playlistHeadLine(1, 180, null, NOW)).toBe('1 song · 3 min')
  })

  it('says how many are listed and in what order', () => {
    expect(playlistsSubline(4, 'recent')).toBe('4 playlists · last played first')
    expect(playlistsSubline(1, 'name')).toBe('1 playlist · A–Z')
    expect(playlistsSubline(2, 'added')).toBe('2 playlists · newest first')
  })
})

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

  it('puts the never-played after every played one, the newest made first', () => {
    const ordered = sortPlaylists(
      [
        playlist('Old made', { createdAt: '2026-08-01 00:00:00' }),
        playlist('Old favourite', {
          createdAt: '2025-01-01 00:00:00',
          lastPlayedAt: '2026-01-10 08:00:00',
        }),
        playlist('Just made', { createdAt: '2026-09-13 06:00:00' }),
      ],
      'recent',
    )
    expect(names(ordered)).toEqual(['Old favourite', 'Just made', 'Old made'])
  })

  it('compares a bucket’s ISO dates with the server’s spaced ones fairly', () => {
    const ordered = sortPlaylists(
      [
        playlist('Server', { lastPlayedAt: '2026-09-12 23:00:00' }),
        playlist('Bucket', { lastPlayedAt: '2026-09-12T22:00:00.000Z' }),
      ],
      'recent',
    )
    expect(names(ordered)).toEqual(['Server', 'Bucket'])
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

describe('what the playlists page lists', () => {
  it('never an empty playlist, of either kind', () => {
    const listed = listedPlaylists(
      [
        playlist('Filled', { songCount: 3 }),
        playlist('Empty'),
        playlist('Matches nothing', { kind: 'live', rules: EMPTY_SMART_RULES }),
      ],
      'recent',
    )
    expect(names(listed)).toEqual(['Filled'])
  })

  it('in the order chosen', () => {
    const listed = listedPlaylists(
      [playlist('Zebra', { songCount: 1 }), playlist('Aardvark', { songCount: 1 })],
      'name',
    )
    expect(names(listed)).toEqual(['Aardvark', 'Zebra'])
  })
})

describe('the playlists a song can be added to', () => {
  it('leaves out live playlists, and lists the one played last first', () => {
    const rules: SmartRules = EMPTY_SMART_RULES
    const choices = playlistsToAddTo([
      playlist('Alpha'),
      playlist('Long songs', { kind: 'live', rules, lastPlayedAt: '2026-09-13 10:00:00' }),
      playlist('Zulu', { lastPlayedAt: '2026-09-12 10:00:00' }),
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

  it('names a copy so it never takes an existing name', () => {
    expect(copyName('Evening', ['Evening'])).toBe('Evening copy')
    expect(copyName('Evening', ['Evening', 'Evening copy', 'Evening copy 2'])).toBe(
      'Evening copy 3',
    )
  })
})
