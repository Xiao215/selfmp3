/**
 * What the player does when a song stops with an error.
 *
 * A failed song must not just sit there — no word on screen, nothing tried
 * again, the queue behind it never reached. The rule is small and ordered:
 *
 *   0. Nobody asked for sound — a song put back paused when the app opened, or
 *      one paused since it was asked for: wait. Nothing is retried or skipped
 *      until Play is pressed, so opening the app never walks the queue.
 *   1. Try it once more, from where it stopped. A connection that dropped for a
 *      moment is the usual cause, and asking for the song again also picks up
 *      a copy downloaded in the meantime.
 *   2. Failed again: skip to the next song that can play, and say so — unless
 *      nothing answered at all, when the next song would fail the same way.
 *   3. Nothing after it, or several songs in a row have failed: stop, and say
 *      so. Skipping on through a whole queue that cannot play — offline, say —
 *      is the queue running away with nobody listening.
 */

type PlaybackRecovery = 'wait' | 'retry' | 'skip' | 'stop'

/** Songs skipped for failing, one after another, before the player gives up. */
export const MAX_SKIPS_IN_A_ROW = 3

export function recoverPlayback(situation: {
  /** The song that failed. */
  readonly songId: number
  /**
   * Sound was asked for and not paused since: a play, a skip, Next while
   * playing. False for a song loaded paused, or one paused while it loaded.
   */
  readonly wantsSound: boolean
  /** The song last tried again after failing, until it has played on for a while. */
  readonly retriedSongId: number | null
  /** Songs skipped for failing, with none playing properly in between. */
  readonly skippedInARow: number
  /** Whether there is a song after this one that can play here. */
  readonly hasNext: boolean
  /** Nothing answered at all: the library's computer, or this device's connection, is away. */
  readonly unreachable: boolean
}): PlaybackRecovery {
  if (!situation.wantsSound) return 'wait'
  if (situation.retriedSongId !== situation.songId) return 'retry'
  if (situation.unreachable) return 'stop'
  if (situation.hasNext && situation.skippedInARow < MAX_SKIPS_IN_A_ROW) return 'skip'
  return 'stop'
}
