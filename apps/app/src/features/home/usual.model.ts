import { usualSlot, type Song, type UsualHours } from '@selfmp3/shared'

/**
 * Home's hour tile, "Usually at this hour" (docs/features/wrapped-and-gems.md):
 * what you reach for around now, on this kind of day, played with one tap.
 * The server works out what you played at each hour (`UsualHours`); this
 * names the hour, finds the songs on this device and picks about forty
 * minutes of them.
 */

/** About this long a tap plays. */
export const USUAL_SECONDS = 40 * 60
/** Fewer of the hour's songs than this on the device, and there is no tile. */
export const USUAL_LEAST_HERE = 5
/** A song of no known length counts as this long. */
const UNKNOWN_SECONDS = 240

/** The tile's name, by the hour: the day's five parts, as the greeting cuts them. */
export function usualName(hour: number): string {
  if (hour >= 5 && hour < 8) return 'Early morning'
  if (hour >= 8 && hour < 12) return 'Morning'
  if (hour >= 12 && hour < 17) return 'Afternoon'
  if (hour >= 17 && hour < 22) return 'Evening'
  return 'Late night'
}

/** Each part of the day's colour, as a tag's hue: dawn, sun, sky, dusk, night. */
export function usualHue(hour: number): number {
  if (hour >= 5 && hour < 8) return 340
  if (hour >= 8 && hour < 12) return 85
  if (hour >= 12 && hour < 17) return 220
  if (hour >= 17 && hour < 22) return 40
  return 265
}

/**
 * The hour's songs on this device, most played around now first: the
 * server's list for this hour of this kind of day, each uid lined up with a
 * song here. Songs no longer here are left out.
 */
export function usualSongs(
  hours: UsualHours | null,
  now: Date,
  songByUid: (uid: string) => Song | undefined,
): Song[] {
  if (!hours) return []
  const { hour, weekend } = usualSlot(now)
  const list = (weekend ? hours.weekend : hours.weekday)[hour] ?? []
  return list.flatMap(place => {
    const uid = hours.songs[place]
    const song = uid === undefined ? undefined : songByUid(uid)
    return song ? [song] : []
  })
}

/**
 * About forty minutes of them, shuffled: each pick drawn at random with the
 * most played more likely, and a different artist from the one before it
 * whenever another is left. `random` is there for the tests.
 */
export function usualPicks(
  songs: readonly Song[],
  random: () => number = Math.random,
  seconds = USUAL_SECONDS,
): number[] {
  const left = songs.map((song, rank) => ({ song, weight: 1 / (1 + rank * 0.1) }))
  const picked: number[] = []
  let total = 0
  let lastArtist: string | null = null
  while (left.length > 0 && total < seconds) {
    const others = left.filter(entry => entry.song.artist !== lastArtist)
    const pool = others.length > 0 ? others : left
    const sum = pool.reduce((acc, entry) => acc + entry.weight, 0)
    let roll = random() * sum
    let chosen = pool[pool.length - 1]
    for (const entry of pool) {
      roll -= entry.weight
      if (roll <= 0) {
        chosen = entry
        break
      }
    }
    if (!chosen) break
    left.splice(left.indexOf(chosen), 1)
    picked.push(chosen.song.id)
    total += chosen.song.duration > 0 ? chosen.song.duration : UNKNOWN_SECONDS
    lastArtist = chosen.song.artist
  }
  return picked
}
