import { describe, expect, it } from 'vitest'
import type { Song, Tag } from '@selfmp3/shared'
import { greeting, homeTiles, recentlyPlayed, streakLine, sundayCard } from './home.model'

const song = (id: number, extra: Partial<Song> = {}): Song => ({
  id,
  path: `${id}.mp3`,
  title: `Song ${id}`,
  artist: 'Someone',
  album: '',
  albumArtist: '',
  trackNo: null,
  year: null,
  duration: 200,
  sizeBytes: 1,
  mime: 'audio/mpeg',
  hasArt: true,
  rev: 'r',
  coverTone: null,
  lyricsKind: 'none',
  instrumental: false,
  playCount: 0,
  skipCount: 0,
  loved: false,
  sourceUrl: null,
  lastPlayedAt: null,
  addedAt: '2026-09-01 00:00:00',
  missing: false,
  tagIds: [],
  audioFeatures: null,
  ...extra,
})

const tag = (id: number, name: string): Tag => ({ id, name, hue: id * 40, songCount: 0 })

describe('greeting', () => {
  it('follows the hour', () => {
    expect(greeting(6)).toBe('Good morning')
    expect(greeting(11)).toBe('Good morning')
    expect(greeting(12)).toBe('Good afternoon')
    expect(greeting(17)).toBe('Good evening')
    expect(greeting(21)).toBe('Good evening')
    expect(greeting(23)).toBe('Good night')
    expect(greeting(2)).toBe('Good night')
  })
})

describe('dateLine', () => {})

describe('streakLine', () => {
  it('says a streak once there is one, and nothing otherwise', () => {
    expect(streakLine(3)).toBe('3 days in a row.')
    expect(streakLine(1)).toBeNull()
    expect(streakLine(0)).toBeNull()
    expect(streakLine(undefined)).toBeNull()
  })
})

describe('homeTiles', () => {
  it('chooses the four most played tags, by the plays of their songs', () => {
    const tags = [1, 2, 3, 4, 5].map(id => tag(id, `t${id}`))
    const songs = [
      song(1, { tagIds: [1], playCount: 1 }),
      song(2, { tagIds: [2], playCount: 50 }),
      song(3, { tagIds: [3], playCount: 20 }),
      song(4, { tagIds: [4], playCount: 30 }),
      song(5, { tagIds: [5], playCount: 10 }),
    ]
    expect(homeTiles(tags, songs).map(tile => tile.tag.id)).toEqual([2, 4, 3, 5])
  })

  it('shows what exists when there are fewer than four, and skips an empty tag', () => {
    const tags = [tag(1, 'chill'), tag(2, 'empty')]
    const tiles = homeTiles(tags, [song(1, { tagIds: [1] }), song(2, { tagIds: [1] })])
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ songs: 2 })
  })

  it('has nothing to show for a library with no tags', () => {
    expect(homeTiles([], [song(1)])).toEqual([])
  })

  it('breaks a tie by size, then by name', () => {
    const tags = [tag(1, 'b'), tag(2, 'a'), tag(3, 'big')]
    const songs = [song(1, { tagIds: [1, 2, 3] }), song(2, { tagIds: [3] })]
    expect(homeTiles(tags, songs).map(tile => tile.tag.name)).toEqual(['big', 'a', 'b'])
  })

  it('puts the most played song with a cover in the corner', () => {
    const tiles = homeTiles(
      [tag(1, 'x')],
      [
        song(1, { tagIds: [1], playCount: 90, hasArt: false }),
        song(2, { tagIds: [1], playCount: 5 }),
        song(3, { tagIds: [1], playCount: 8 }),
      ],
    )
    expect(tiles[0]?.cover?.id).toBe(3)
  })
})

describe('recentlyPlayed', () => {
  it('is newest first, played songs only, and each song once', () => {
    const songs = [
      song(1, { lastPlayedAt: '2026-09-10 10:00:00' }),
      song(2),
      song(3, { lastPlayedAt: '2026-09-12 08:00:00' }),
      song(4, { lastPlayedAt: '2026-09-11 23:00:00', missing: true }),
      song(3, { lastPlayedAt: '2026-09-12 08:00:00' }),
    ]
    expect(recentlyPlayed(songs).map(entry => entry.id)).toEqual([3, 1])
  })

  it('is empty for a library nobody has played yet', () => {
    expect(recentlyPlayed([song(1), song(2)])).toEqual([])
  })
})

describe('homeTiles on a computer', () => {
  it('takes six when asked for six', () => {
    const tags = [1, 2, 3, 4, 5, 6, 7].map(id => tag(id, `t${id}`))
    const songs = tags.map(entry => song(entry.id, { tagIds: [entry.id] }))
    expect(homeTiles(tags, songs, 6)).toHaveLength(6)
    expect(homeTiles(tags, songs)).toHaveLength(4)
  })
})

describe('the Sunday card', () => {
  const week = {
    totals: { plays: 40, minutes: 134 } as never,
    topArtists: [{ key: 'Yorushika feat. suis', plays: 20, minutes: 80 }],
    streakDays: 3,
  }
  const sunday = new Date(2026, 8, 20, 10, 15)
  const monday = new Date(2026, 8, 21, 10, 15)

  it('says what the week held, on a Sunday', () => {
    expect(sundayCard(sunday, week)).toEqual({
      title: 'Your week is ready',
      line: '2 hr 14 min · Yorushika, mostly · 3-day streak',
    })
  })

  it('is not there on any other day', () => {
    expect(sundayCard(monday, week)).toBeNull()
  })

  it('is not there for a quiet week, or before the numbers arrive', () => {
    expect(sundayCard(sunday, { ...week, totals: { plays: 0, minutes: 0 } as never })).toBeNull()
    expect(sundayCard(sunday, undefined)).toBeNull()
  })

  it('leaves out a streak of one day, and an artist it does not know', () => {
    expect(sundayCard(sunday, { ...week, streakDays: 1, topArtists: [] })?.line).toBe('2 hr 14 min')
  })
})
