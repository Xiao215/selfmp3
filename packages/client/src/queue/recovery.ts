/**
 * What the player does when a song stops with an error.
 *
 * A song that failed used to sit there: no word on screen, nothing tried again,
 * and the queue behind it never reached. The rule is small and ordered:
 *
 *   1. Try it once more, from where it stopped. A connection that dropped for a
 *      moment is the usual cause, and asking for the song again also picks up
 *      a copy downloaded in the meantime.
 *   2. Failed again: skip to the next song that can play, and say so.
 *   3. Nothing after it, or several songs in a row have failed: stop, and say
 *      so. Skipping on through a whole queue that cannot play — offline, say —
 *      is the queue running away with nobody listening.
 */

export type PlaybackRecovery = 'retry' | 'skip' | 'stop'

/** Songs skipped for failing, one after another, before the player gives up. */
export const MAX_SKIPS_IN_A_ROW = 3

export function recoverPlayback(situation: {
  /** The song that failed. */
  readonly songId: number
  /** The song last tried again after failing, until it has played on for a while. */
  readonly retriedSongId: number | null
  /** Songs skipped for failing, with none playing properly in between. */
  readonly skippedInARow: number
  /** Whether there is a song after this one that can play here. */
  readonly hasNext: boolean
}): PlaybackRecovery {
  if (situation.retriedSongId !== situation.songId) return 'retry'
  if (situation.hasNext && situation.skippedInARow < MAX_SKIPS_IN_A_ROW) return 'skip'
  return 'stop'
}
