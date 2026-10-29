/**
 * When a song counts as played, and how much of it was heard.
 *
 * The numbers — the two-second gap that separates playing from seeking, and
 * the minute that has to be heard — and the rule are shared/plays.ts, so the
 * server holds every play it is sent to the same rule.
 *
 * The surrounding bookkeeping stays in each platform's player: the web reads a
 * `<audio>` element's `currentTime` and the phone is told a position by the
 * native player, and each holds it in a ref it mutates on a hot path. Only the
 * arithmetic is here.
 */

import { LISTENING_GAP_SECONDS } from '@selfmp3/shared'

export { PLAY_COUNT_SECONDS, countsAsPlay, secondsToCount } from '@selfmp3/shared'

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
