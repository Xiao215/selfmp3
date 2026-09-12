/**
 * When a song counts as played, and how much of it was heard.
 *
 * Two numbers decided this in both apps, written out twice: the two-second gap
 * that separates playing from seeking, and the four-minute cap on how much of a
 * long song has to be heard. A play counted differently depending on which
 * device was in your hand is a wrong play count, wrong stats and a wrong
 * Wrapped, and nothing would have caught the two drifting apart.
 *
 * The surrounding bookkeeping stays in each app's player: the web reads a
 * `<audio>` element's `currentTime` and the phone is told a position by the
 * native player, and each holds it in a ref it mutates on a hot path. Only the
 * arithmetic is here.
 */

/**
 * The longest a song can be asked to be heard for before it counts.
 *
 * Without it a threshold of half means twenty minutes of a long mix before the
 * play registers, by which time you have moved on and it never does.
 */
export const PLAY_THRESHOLD_CAP_SECONDS = 240

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

/**
 * How many seconds of this song have to be heard before it counts as a play.
 *
 * `threshold` is the fraction from the server's settings, which is the one
 * setting the two clients have to agree about.
 */
export function secondsToCount(duration: number, threshold: number): number {
  return Math.min(duration * threshold, PLAY_THRESHOLD_CAP_SECONDS)
}
