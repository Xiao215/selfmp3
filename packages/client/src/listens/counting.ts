/**
 * When a song counts as played, and how much of it was heard.
 *
 * These two numbers must agree everywhere, so they are written once rather
 * than once per client: the two-second gap that separates playing from
 * seeking, and the minute that has to be heard. A play counted differently
 * depending on which device was in your hand is a wrong play count, wrong
 * stats and a wrong Wrapped, and nothing would have caught the two drifting
 * apart.
 *
 * The surrounding bookkeeping stays in each platform's player: the web reads a
 * `<audio>` element's `currentTime` and the phone is told a position by the
 * native player, and each holds it in a ref it mutates on a hot path. Only the
 * arithmetic is here.
 */

/**
 * How long a song has to be heard before it counts as a play: a minute.
 *
 * It used to be a fraction of the song, capped at four minutes. Half of an
 * hour-long mix is more than anyone has, and a minute is what "I listened to
 * it" means whatever the length. A shorter song counts once all of it has been
 * heard, and any song that plays to its end counts (the callers pass that).
 */
export const PLAY_COUNT_SECONDS = 60

/**
 * The largest jump in the playhead that is still listening rather than seeking.
 *
 * Progress arrives as a position, not an elapsed time, so scrubbing looks
 * exactly like playing very fast. Anything bigger than a normal tick is a seek
 * and contributes nothing, which is what stops dragging the scrubber back and
 * forth from inflating a play count.
 */
const LISTENING_GAP_SECONDS = 2

/**
 * How much listening this tick added, given where the playhead was last time.
 *
 * Zero for a rewind and zero for a jump forward, so only time actually spent
 * listening accumulates.
 */
export function listenedDelta(position: number, lastPosition: number): number {
  const delta = position - lastPosition
  return delta > 0 && delta < LISTENING_GAP_SECONDS ? delta : 0
}

/** How many seconds of this song have to be heard before it counts as a play. */
export function secondsToCount(duration: number): number {
  return Math.min(PLAY_COUNT_SECONDS, Math.max(0, duration))
}
