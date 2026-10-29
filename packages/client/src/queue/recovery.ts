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
 *
 * A storage busy for a moment (Backblaze's SlowDown) goes its own way: the
 * song is asked for again after a wait that grows each time
 * (`busyRetryDelay`), never skipped, and the player stops only once it has
 * waited a few minutes. The next song would be refused the same way, and
 * skipping walked three good songs in a second (bug bash R3-M2).
 */

type PlaybackRecovery = 'wait' | 'retry' | 'retry-later' | 'skip' | 'stop'

/** Songs skipped for failing, one after another, before the player gives up. */
export const MAX_SKIPS_IN_A_ROW = 3

/** The waits between asking a busy storage for the same song again, after which the last repeats. */
const BUSY_WAITS_MS = [2_000, 4_000, 8_000, 15_000, 30_000] as const

/** Times a song is asked for again from a busy storage before the player stops: about four minutes. */
export const MAX_BUSY_TRIES = 11

/** How long to wait before asking a busy storage for the song again, having asked `tries` times. */
export function busyRetryDelay(tries: number): number {
  return BUSY_WAITS_MS[Math.min(Math.max(0, tries), BUSY_WAITS_MS.length - 1)]!
}

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
  /** The storage answered that it is busy for a moment: nothing is wrong with the song. */
  readonly busy: boolean
  /** Times this song has been asked for again from a busy storage, with none of it playing since. */
  readonly busyTries: number
}): PlaybackRecovery {
  if (!situation.wantsSound) return 'wait'
  if (situation.busy) return situation.busyTries < MAX_BUSY_TRIES ? 'retry-later' : 'stop'
  if (situation.retriedSongId !== situation.songId) return 'retry'
  if (situation.unreachable) return 'stop'
  if (situation.hasNext && situation.skippedInARow < MAX_SKIPS_IN_A_ROW) return 'skip'
  return 'stop'
}
