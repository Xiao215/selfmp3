import { describe, expect, it } from 'vitest'

import {
  busiestDay,
  bylineRest,
  hourWords,
  playStrip,
  songLink,
  songPlays,
  songStory,
  soundWords,
  timeAgo,
  usualHour,
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

describe('songStory', () => {
  const song = {
    playCount: 14,
    addedAt: new Date(2026, 7, 28, 12).toISOString(),
    lastPlayedAt: null,
  }

  it('says a song was never played, and when it came', () => {
    expect(songStory({ ...song, playCount: 0 }, [], NOW)).toEqual({
      count: null,
      lead: 'Not played yet. You added it ',
      when: '3 weeks ago',
      tail: '.',
    })
  })

  it('counts plays from the record alone, with the last play', () => {
    const story = songStory({ ...song, lastPlayedAt: local(17, 22) }, [], NOW)
    expect(story.count).toBe(14)
    expect(story.lead).toBe(' plays since you added it ')
    expect(story.tail).toBe('. Last played yesterday.')
  })

  it('says one play, not one plays', () => {
    expect(songStory({ ...song, playCount: 1 }, [], NOW).lead).toBe(' play since you added it ')
  })

  it('names the habit when the history shows one', () => {
    const plays = [
      local(12, 23, 5),
      local(12, 22, 50),
      local(12, 23, 40),
      local(12, 23, 55),
      local(12, 23, 10),
      local(12, 22, 30),
      local(15, 9),
    ]
    // 12 September 2026 is a Saturday.
    expect(songStory(song, plays, NOW).tail).toBe(
      '. Mostly around 11 pm, and six times on one Saturday.',
    )
  })
})

describe('usualHour', () => {
  it('needs three plays and a majority around one hour', () => {
    expect(usualHour([new Date(2026, 8, 1, 23), new Date(2026, 8, 2, 23)])).toBeNull()
    expect(
      usualHour([new Date(2026, 8, 1, 23), new Date(2026, 8, 2, 0), new Date(2026, 8, 3, 22)]),
    ).toBe(23)
    expect(
      usualHour([
        new Date(2026, 8, 1, 3),
        new Date(2026, 8, 2, 9),
        new Date(2026, 8, 3, 15),
        new Date(2026, 8, 3, 20),
      ]),
    ).toBeNull()
  })
})

describe('busiestDay', () => {
  it('is a day of three plays or more', () => {
    expect(busiestDay([new Date(2026, 8, 12, 1), new Date(2026, 8, 12, 2)])).toBeNull()
    expect(
      busiestDay([new Date(2026, 8, 14, 1), new Date(2026, 8, 14, 2), new Date(2026, 8, 14, 3)]),
    ).toEqual({ plays: 3, weekday: 'Monday' })
  })
})

describe('hourWords', () => {
  it('reads the clock as people say it', () => {
    expect(hourWords(0)).toBe('midnight')
    expect(hourWords(9)).toBe('9 am')
    expect(hourWords(12)).toBe('noon')
    expect(hourWords(23)).toBe('11 pm')
  })
})

describe('songPlays', () => {
  it('keeps this song’s plays and how far back the history goes', () => {
    const events = [
      { songId: 7, playedAt: local(17, 12) },
      { songId: 3, playedAt: local(16, 12) },
      { songId: 7, playedAt: local(2, 9) },
      { songId: 3, playedAt: local(1, 9) },
    ]
    expect(songPlays(events, id => id === 7)).toEqual({
      playedAt: [local(17, 12), local(2, 9)],
      coveredFrom: local(1, 9),
    })
    expect(songPlays([], () => true)).toEqual({ playedAt: [], coveredFrom: null })
  })
})

describe('playStrip', () => {
  it('spreads plays from the day it was added, tallest at 1', () => {
    const strip = playStrip({
      playedAt: [local(11, 12), local(17, 12), local(17, 13)],
      addedAt: local(4, 12),
      coveredFrom: null,
      now: NOW,
      slices: 14,
    })
    // Fourteen days in fourteen slices: one a day.
    expect(strip?.bars).toHaveLength(14)
    expect(strip?.bars[7]).toBe(0.5)
    expect(strip?.bars[13]).toBe(1)
    expect(strip?.peak).toBe(13)
  })

  it('starts where the history starts when it reaches back less far', () => {
    const strip = playStrip({
      playedAt: [local(17, 12)],
      addedAt: '2025-01-01T00:00:00.000Z',
      coveredFrom: local(16, 12),
      now: NOW,
      slices: 2,
    })
    expect(strip?.bars).toEqual([0, 1])
  })

  it('is nothing when none of its plays are known', () => {
    expect(
      playStrip({ playedAt: [], addedAt: local(1, 12), coveredFrom: null, now: NOW }),
    ).toBeNull()
  })
})

describe('soundWords', () => {
  it('is the tempo and a word for the energy', () => {
    expect(soundWords({ bpm: 91.6, energy: 0.2 } as never)).toBe('tempo 92 · calm')
    expect(soundWords({ bpm: null, energy: 0.9 } as never)).toBe('driving')
    expect(soundWords(null)).toBeNull()
  })
})

describe('bylineRest', () => {
  it('is the album and the length, leaving out what is empty', () => {
    expect(bylineRest({ album: 'Elma', duration: 272 })).toBe('Elma · 4:32')
    expect(bylineRest({ album: ' ', duration: 0 })).toBe('')
  })
})
