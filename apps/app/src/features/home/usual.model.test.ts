import { describe, expect, it } from 'vitest'
import type { Song, UsualHours } from '@selfmp3/shared'
import { USUAL_SECONDS, usualName, usualPicks, usualSongs } from './usual.model'

const song = (id: number, artist: string, duration = 240): Song =>
  ({ id, artist, duration, title: `Song ${id}` }) as Song

describe('usualName', () => {
  it('follows the hour through the day', () => {
    expect([5, 7, 8, 11, 12, 16, 17, 21, 22, 0, 4].map(usualName)).toEqual([
      'Early morning',
      'Early morning',
      'Morning',
      'Morning',
      'Afternoon',
      'Afternoon',
      'Evening',
      'Evening',
      'Late night',
      'Late night',
      'Late night',
    ])
  })
})

describe('usualSongs', () => {
  const empty = (): number[][] => Array.from({ length: 24 }, () => [])
  const hours: UsualHours = {
    songs: ['a', 'b', 'c'],
    weekday: empty().map((list, hour) => (hour === 1 ? [2, 0] : list)),
    weekend: empty().map((list, hour) => (hour === 10 ? [1] : list)),
  }
  const here = new Map([
    ['a', song(1, 'x')],
    ['c', song(3, 'y')],
  ])

  it('reads this hour of this kind of day, and leaves out songs not here', () => {
    // Saturday 01:00 is still Friday night: a weekday's.
    const saturdayNight = new Date(2026, 9, 24, 1, 0)
    expect(usualSongs(hours, saturdayNight, uid => here.get(uid)).map(each => each.id)).toEqual([
      3, 1,
    ])
    const saturdayMorning = new Date(2026, 9, 24, 10, 0)
    expect(usualSongs(hours, saturdayMorning, uid => here.get(uid))).toEqual([])
  })

  it('has nothing without an answer', () => {
    expect(usualSongs(null, new Date(), () => undefined)).toEqual([])
  })
})

describe('usualPicks', () => {
  it('plays about forty minutes, each song once, never the same artist twice running when it can help it', () => {
    const songs = Array.from({ length: 30 }, (_, index) =>
      song(index + 1, index % 3 === 0 ? 'A' : index % 3 === 1 ? 'B' : 'C'),
    )
    let seed = 1
    const random = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const picks = usualPicks(songs, random)
    expect(new Set(picks).size).toBe(picks.length)
    expect(picks.length).toBe(USUAL_SECONDS / 240)
    const artists = picks.map(id => songs[id - 1]?.artist)
    for (let at = 1; at < artists.length; at++) expect(artists[at]).not.toBe(artists[at - 1])
  })

  it('plays what there is when there is less than forty minutes of it', () => {
    expect(usualPicks([song(1, 'A'), song(2, 'A')], () => 0.5).sort()).toEqual([1, 2])
  })
})
