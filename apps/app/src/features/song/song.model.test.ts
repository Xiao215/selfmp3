import { describe, expect, it } from 'vitest'

import {
  bylineRest,
  cameFrom,
  playedWords,
  playSimilarOrder,
  songLink,
  songStory,
  unplayedLine,
  timeAgo,
} from './song.model'

// Built from local time, so the hours and days below mean the same in any zone.
const local = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 8, day, hour, minute).toISOString()
const NOW = new Date(2026, 8, 18, 12, 0)

describe('songLink', () => {
  it('is the song page by id', () => {
    expect(songLink(42)).toBe('/song/42')
  })
})

describe('timeAgo', () => {
  it('counts calendar days, then weeks, months and years', () => {
    expect(timeAgo(local(18, 8), NOW)).toBe('today')
    expect(timeAgo(local(17, 23), NOW)).toBe('yesterday')
    expect(timeAgo(local(14, 12), NOW)).toBe('4 days ago')
    expect(timeAgo(local(10, 12), NOW)).toBe('a week ago')
    expect(timeAgo(local(1, 12), NOW)).toBe('2 weeks ago')
    expect(timeAgo(new Date(2026, 6, 1).toISOString(), NOW)).toBe('2 months ago')
    expect(timeAgo(new Date(2025, 8, 1).toISOString(), NOW)).toBe('a year ago')
    expect(timeAgo(new Date(2023, 1, 1).toISOString(), NOW)).toBe('3 years ago')
  })

  it('reads a SQLite date as UTC', () => {
    const utc = new Date(Date.UTC(2026, 8, 4, 12, 0))
    const sqlite = utc.toISOString().replace('T', ' ').slice(0, 19)
    expect(timeAgo(sqlite, NOW)).toBe(timeAgo(utc.toISOString(), NOW))
  })

  it('does not throw on a date it cannot read', () => {
    expect(timeAgo('not a date', NOW)).toBe('a while ago')
  })
})

/** A UTC play time as the server writes it, from local parts. */
const sqlite = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19)
const at = (month: number, day: number, hour: number, minute = 0): string =>
  sqlite(new Date(2026, month, day, hour, minute))
/** The server's hours: one entry per play here, which is how the hours add up anyway. */
const hours = (...times: string[]) =>
  times.map(time => ({ at: time.slice(0, 13) + ':00:00', plays: 1 }))

describe('songStory', () => {
  const song = {
    addedAt: at(7, 3, 10),
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    playCount: 2,
    lastPlayedAt: at(8, 17, 23, 40),
  }

  it('says what the device knows when no server answers, and nothing more', () => {
    const story = songStory(song, null, NOW)
    expect(story.rows).toEqual([
      { key: 'came', label: 'Came in', value: '3 August', sub: 'from YouTube' },
      { key: 'last', label: 'Last', value: 'Yesterday, 23:40', sub: '2 plays' },
    ])
    expect(story.strip).toBeNull()
  })

  it('leaves out the last play of a song never played', () => {
    const story = songStory({ ...song, playCount: 0, lastPlayedAt: null }, null, NOW)
    expect(story.rows.map(row => row.key)).toEqual(['came'])
  })

  it('tells the whole story from the server: first, best week, last, and the weeks', () => {
    // Four plays the week of Monday 10 August, one on the 5th, one yesterday.
    const plays = [
      at(7, 5, 21),
      at(7, 10, 9),
      at(7, 11, 22),
      at(7, 12, 23),
      at(7, 16, 8),
      at(8, 17, 23, 40),
    ]
    const story = songStory(
      song,
      {
        songId: 1,
        cameWith: { kind: 'room', from: 'Mia' },
        plays: plays.length,
        msPlayed: 6 * 4 * 60_000,
        firstPlayedAt: plays[0] ?? null,
        lastPlayedAt: plays.at(-1) ?? null,
        hours: hours(...plays),
      },
      NOW,
    )
    expect(story.rows).toEqual([
      { key: 'came', label: 'Came in', value: '3 August', sub: 'from Mia, in a room' },
      { key: 'first', label: 'First', value: '5 August', sub: '2 days later' },
      { key: 'best', label: 'Best week', value: '4 plays', sub: 'week of 10 August' },
      { key: 'last', label: 'Last', value: 'Yesterday, 23:40', sub: '6 plays · 24 min in all' },
    ])
    // From the week of 3 August to the week of 14 September: seven weeks.
    expect(story.strip?.bars).toHaveLength(7)
    expect(story.strip?.peak).toBe(1)
    expect(story.strip?.bars[1]).toBe(1)
    expect(story.strip?.caption).toBe('Weeks since 3 August')
  })

  it('has no best week until one week holds a few plays', () => {
    const plays = [at(7, 5, 21), at(8, 17, 23)]
    const story = songStory(
      song,
      {
        songId: 1,
        cameWith: null,
        plays: 2,
        msPlayed: 1,
        firstPlayedAt: plays[0] ?? null,
        lastPlayedAt: plays[1] ?? null,
        hours: hours(...plays),
      },
      NOW,
    )
    expect(story.rows.map(row => row.key)).toEqual(['came', 'first', 'last'])
  })

  it('puts a few weeks in a bar once the song has been here over a year', () => {
    const old = { ...song, addedAt: sqlite(new Date(2024, 0, 3)) }
    const plays = [sqlite(new Date(2024, 0, 4, 12))]
    const story = songStory(
      old,
      {
        songId: 1,
        cameWith: null,
        plays: 1,
        msPlayed: 1,
        firstPlayedAt: plays[0] ?? null,
        lastPlayedAt: plays[0] ?? null,
        hours: hours(...plays),
      },
      NOW,
    )
    expect(story.strip?.bars.length).toBeLessThanOrEqual(52)
    expect(story.strip?.caption).toBe('Since 3 January 2024')
    expect(story.rows[1]).toMatchObject({ value: '4 January 2024', sub: '1 day later' })
  })

  it('draws no strip for a stay of a week or two', () => {
    const fresh = { ...song, addedAt: at(8, 15, 9) }
    const plays = [at(8, 16, 9)]
    const story = songStory(
      fresh,
      {
        songId: 1,
        cameWith: null,
        plays: 1,
        msPlayed: 1,
        firstPlayedAt: plays[0] ?? null,
        lastPlayedAt: plays[0] ?? null,
        hours: hours(...plays),
      },
      NOW,
    )
    expect(story.strip).toBeNull()
  })
})

describe('cameFrom', () => {
  it('names the friend, then the site, then a file', () => {
    expect(cameFrom({ sourceUrl: null }, { kind: 'link', from: 'Kai' })).toBe(
      'from a link Kai sent',
    )
    expect(cameFrom({ sourceUrl: 'https://music.163.com/song?id=1' }, null)).toBe('from 网易云')
    expect(cameFrom({ sourceUrl: null }, null)).toBe('from a file')
  })
})

describe('playedWords', () => {
  it('says today and yesterday with the time, and the day before that', () => {
    expect(playedWords(new Date(2026, 8, 18, 8, 5), NOW)).toBe('Today, 08:05')
    expect(playedWords(new Date(2026, 8, 17, 23, 40), NOW)).toBe('Yesterday, 23:40')
    expect(playedWords(new Date(2026, 8, 2, 23, 40), NOW)).toBe('2 September')
    expect(playedWords(new Date(2025, 8, 2), NOW)).toBe('2 September 2025')
  })
})

describe('unplayedLine', () => {
  it('says a song was never played, and when it came, in one line', () => {
    const now = new Date('2026-10-25T12:00:00Z')
    expect(unplayedLine({ playCount: 0, addedAt: '2026-09-20 12:00:00' }, now)).toBe(
      'Not played yet · added a month ago',
    )
    expect(unplayedLine({ playCount: 2, addedAt: '2026-09-20 12:00:00' }, now)).toBeNull()
  })
})

describe('bylineRest', () => {
  it('is the album and the length, leaving out what is empty', () => {
    expect(bylineRest({ album: 'Elma', duration: 272 })).toBe('Elma · 4:32')
    expect(bylineRest({ album: ' ', duration: 0 })).toBe('')
  })
})

describe('the similar-songs shelf', () => {
  it('plays the chosen song first, then the rest in their order', () => {
    expect(playSimilarOrder([4, 7, 9, 2], 9)).toEqual([9, 4, 7, 2])
    expect(playSimilarOrder([4, 7], 4)).toEqual([4, 7])
  })
})
