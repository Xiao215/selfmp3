import type { UsualHours } from '@selfmp3/shared'

/**
 * "Usually at this hour" (docs/features/wrapped-and-gems.md): what you reach
 * for around each hour of a weekday and of a weekend, from your own plays.
 *
 * A song's score at an hour is its plays in that hour and half its plays in
 * the hour either side, so 22:50 and 23:10 count together, each play worth
 * less the longer ago it was (`HALF_LIFE_WEEKS`): what you played this
 * autumn, not what you played all spring. An hour is only answered once it
 * holds enough to be a habit (`MIN_PLAYS` plays of `MIN_SONGS` songs in its
 * window); otherwise its list is empty and Home shows no tile then.
 */

/** How far back the plays are read. */
export const USUAL_DAYS = 180
/** A play's weight halves every this many weeks. */
const HALF_LIFE_WEEKS = 8
/** Plays in an hour's window, and different songs among them, before it is a habit. */
const MIN_PLAYS = 20
export const MIN_SONGS = 8
/** The most songs an hour lists: a few times the forty minutes a tap plays. */
const SHORTLIST = 40
/** What the hour either side counts for. */
const BESIDE = 0.5

/** A song at an hour: its plays weighed by how long ago, and its plays. */
interface Cell {
  score: number
  plays: number
}

interface UsualRow {
  readonly uid: string
  readonly hour: number
  readonly weekend: boolean
  readonly weeksAgo: number
  readonly plays: number
}

export function usualHours(rows: readonly UsualRow[]): UsualHours {
  // Per kind of day and hour: each song's weighted plays and its plays.
  const cells = (): Map<string, Cell>[] => Array.from({ length: 24 }, () => new Map<string, Cell>())
  const byKind = { weekday: cells(), weekend: cells() }
  for (const row of rows) {
    const hour = byKind[row.weekend ? 'weekend' : 'weekday'][row.hour]
    if (!hour) continue
    const cell: Cell = hour.get(row.uid) ?? { score: 0, plays: 0 }
    cell.score += row.plays * 0.5 ** (row.weeksAgo / HALF_LIFE_WEEKS)
    cell.plays += row.plays
    hour.set(row.uid, cell)
  }

  const songs: string[] = []
  const place = new Map<string, number>()
  const placeOf = (uid: string): number => {
    let at = place.get(uid)
    if (at === undefined) {
      at = songs.length
      songs.push(uid)
      place.set(uid, at)
    }
    return at
  }

  const lists = (hours: readonly Map<string, Cell>[]): number[][] =>
    hours.map((_, hour) => {
      const scores = new Map<string, Cell>()
      for (const [shift, weight] of [
        [-1, BESIDE],
        [0, 1],
        [1, BESIDE],
      ] as const) {
        for (const [uid, cell] of hours[(hour + shift + 24) % 24] ?? []) {
          const sum = scores.get(uid) ?? { score: 0, plays: 0 }
          sum.score += cell.score * weight
          sum.plays += cell.plays
          scores.set(uid, sum)
        }
      }
      let plays = 0
      for (const sum of scores.values()) plays += sum.plays
      if (plays < MIN_PLAYS || scores.size < MIN_SONGS) return []
      return [...scores]
        .sort(([a, x], [b, y]) => y.score - x.score || (a < b ? -1 : 1))
        .slice(0, SHORTLIST)
        .map(([uid]) => placeOf(uid))
    })

  return { songs, weekday: lists(byKind.weekday), weekend: lists(byKind.weekend) }
}
