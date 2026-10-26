import { DAY_MS } from './math.js'

/**
 * Resting songs (docs/features/lists.md, "Resting songs"): a song you are
 * tired of for now, put to sleep for a month rather than untagged or deleted.
 * Shuffle, a list played whole, Ask's picks, Forgotten gems and Keep going
 * pass over it; a tap on its row still plays it. It wakes by itself.
 *
 * One rule, read by the server, the device's copy and the app alike.
 */

/** How long a song rests: one length, a month (N1a, 2026-10-25). */
export const REST_DAYS = 30

/** What resting reads of a song: a `Song` and a `CloudSong` both have it. */
interface RestFields {
  readonly restUntil: string | null
}

/** When a song rested now wakes, as the field holds it. */
export function restUntilFrom(now = Date.now()): string {
  return new Date(now + REST_DAYS * DAY_MS).toISOString()
}

/** Whether the song is resting now. A time that will not read is awake. */
export function isResting(song: RestFields, now = Date.now()): boolean {
  if (song.restUntil === null) return false
  const until = Date.parse(song.restUntil)
  return Number.isFinite(until) && until > now
}
