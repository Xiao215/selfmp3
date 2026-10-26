import { parseDoormanRefusal } from '@selfmp3/shared'
import type { DevicePlace } from '../features/settings/settings.model'

/**
 * Why a song would not play, from what its stream address answers.
 *
 * An `<audio>` element that cannot use its source says only that — the same
 * "not supported" for a bucket past its day's allowance, a doorman that is
 * down, and a song that was never saved on this device — and the player
 * said "not available offline" for all three. The address itself says which:
 * asked for one byte, it answers with the service worker's words (a 503 in
 * plain text) or the doorman's (a 502 in JSON, with `error`).
 *
 * The service worker's 503 is always the same news — the song is not here and
 * the network did not bring it — so it is said in the app's words for this
 * device (`notHere`) rather than the worker's, which cannot know the place.
 */
export function streamFailureMessage(status: number, body: string, place: DevicePlace): string {
  const text = body.trim()
  const plain = status === 404 || status === 503 ? notHere(place) : 'Could not play this song'
  // JSON is the doorman's, or nothing worth repeating.
  if (text.startsWith('{')) return parseDoormanRefusal(text)?.error.trim() || plain
  if (status === 503) return plain
  if (text && text.length <= 300 && !text.startsWith('<')) return text.replace(/\.$/, '')
  return plain
}

/**
 * Nothing answered at all: no server, no doorman, no connection. Said apart
 * from a refusal, because the next song would get no answer either — the
 * player stops on it rather than skipping down the queue (`isUnreachable`).
 */
export const LOST_CONNECTION = 'Lost connection to the library'

/**
 * A song asked to play that did not start arriving in time (engine.web.ts,
 * `#watchStart`): a read that stalled, though everything else answers. Said
 * as what happened. It was said as an unreachable library, which sent people
 * to check a connection that was fine.
 */
export const TOOK_TOO_LONG = 'This song took too long to arrive'

/**
 * Whether a song failed on the way to it rather than in it: nothing answered,
 * or it never came. The next song would most likely fail the same way, so the
 * player stops on it rather than skipping down the queue.
 */
export function isUnreachable(error: string | null): boolean {
  return error === LOST_CONNECTION || error === TOOK_TOO_LONG
}

/**
 * What the player says when it stops on a song for good. Nothing answering
 * is the connection's fault, not the song's: "Couldn't play “…”" during an
 * outage sent people looking for something wrong with the file. The words are
 * the ones the rest of the app uses for an unreachable library.
 */
export function stoppedOn(title: string, error: string | null): string {
  if (error === LOST_CONNECTION) return 'Can’t reach your library'
  if (error === TOOK_TOO_LONG) return `“${title}” took too long to load`
  return `Couldn’t play “${title}”`
}

/** A song with no copy here and no way to fetch one. */
export function notHere(place: DevicePlace): string {
  return `This song isn’t on this ${place}`
}

/**
 * A song the player has no address for at all: named when the player knows
 * its title, which it does for any song in the library.
 */
export function cannotPlayYet(title: string | null | undefined, place: DevicePlace): string {
  return title
    ? `“${title}” can’t be played on this ${place} yet.`
    : `This song can’t be played on this ${place} yet.`
}
