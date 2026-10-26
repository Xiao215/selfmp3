import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrate.js'
import { createLogger } from '../logger.js'
import { StatsRepository } from '../repositories/stats.js'
import { MIN_SONGS, USUAL_DAYS, usualHours } from './usualHours.js'

const uid = (n: number): string => n.toString(16).padStart(32, '0')

/** `plays` plays of each of `songs` songs at one hour of one kind of day, `weeksAgo` back. */
function rows(
  songs: number,
  plays: number,
  hour: number,
  weekend: boolean,
  weeksAgo = 0,
  from = 1,
): { uid: string; hour: number; weekend: boolean; weeksAgo: number; plays: number }[] {
  return Array.from({ length: songs }, (_, index) => ({
    uid: uid(from + index),
    hour,
    weekend,
    weeksAgo,
    plays,
  }))
}

describe('usualHours', () => {
  it('lists an hour’s songs most played first, the hours either side counting half', () => {
    const answer = usualHours([
      ...rows(MIN_SONGS, 3, 23, false),
      // Played a lot at 22:00, which counts half at 23:00.
      { uid: uid(50), hour: 22, weekend: false, weeksAgo: 0, plays: 9 },
    ])
    const at23 = (answer.weekday[23] ?? []).map(place => answer.songs[place])
    expect(at23[0]).toBe(uid(50))
    expect(at23).toHaveLength(MIN_SONGS + 1)
    expect(answer.weekend[23]).toEqual([])
  })

  it('answers nothing for an hour too thin to be a habit', () => {
    const few = usualHours(rows(MIN_SONGS - 1, 5, 9, true))
    expect(few.weekend[9]).toEqual([])
    const quiet = usualHours(rows(MIN_SONGS, 1, 9, true))
    expect(quiet.weekend[9]).toEqual([])
  })

  it('weighs this autumn over the spring', () => {
    const answer = usualHours([
      ...rows(MIN_SONGS, 3, 14, false, 0),
      { uid: uid(90), hour: 14, weekend: false, weeksAgo: 20, plays: 6 },
      { uid: uid(91), hour: 14, weekend: false, weeksAgo: 0, plays: 4 },
    ])
    const list = (answer.weekday[14] ?? []).map(place => answer.songs[place])
    expect(list.indexOf(uid(91))).toBeLessThan(list.indexOf(uid(90)))
  })

  it('names each song once, however many hours it is in', () => {
    const answer = usualHours([...rows(MIN_SONGS, 3, 10, false), ...rows(MIN_SONGS, 3, 18, false)])
    expect(answer.songs).toHaveLength(MIN_SONGS)
    expect(answer.weekday).toHaveLength(24)
  })
})

describe('StatsRepository.usualPlays', () => {
  it('reads the hours in the asker’s time, and one on a Saturday morning as Friday night', () => {
    const db = new Database(':memory:')
    migrate(db, createLogger('silent'))
    db.prepare("INSERT INTO songs (id, path, title, uid) VALUES (1, 'a', 'A', ?)").run(uid(1))
    // Saturday 02:30 in UTC-7 (Etc/GMT+7, which keeps no summer time) is
    // 09:30 UTC: a weekday's (Friday's) night.
    // Saturday 10:00 in UTC-7 is 17:00 UTC: a weekend.
    const saturday = new Date()
    saturday.setUTCDate(saturday.getUTCDate() - ((saturday.getUTCDay() + 1) % 7) - 7)
    const day = saturday.toISOString().slice(0, 10)
    const insert = db.prepare('INSERT INTO play_events (song_id, played_at) VALUES (1, ?)')
    insert.run(`${day} 09:30:00`)
    insert.run(`${day} 17:00:00`)
    const plays = new StatsRepository(db).usualPlays('Etc/GMT+7', USUAL_DAYS)
    expect(plays.map(({ hour, weekend }) => ({ hour, weekend }))).toEqual(
      expect.arrayContaining([
        { hour: 2, weekend: false },
        { hour: 10, weekend: true },
      ]),
    )
  })
})
