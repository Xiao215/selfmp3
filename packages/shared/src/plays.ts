/**
 * When a song counts as played: one rule for every player and the server.
 *
 * These numbers must agree everywhere, so they are written once rather than
 * once per client: a play counted differently depending on which device was
 * in your hand is a wrong play count, wrong stats and a wrong Wrapped. The
 * server holds what it is sent to the same rule (apps/server routes/songs.ts,
 * cloudIngest.ts), so a client that miscounts cannot put it in Stats.
 */

/**
 * How long a song has to be heard before it counts as a play: a minute.
 *
 * A flat minute rather than a fraction of the song: half of an hour-long mix
 * is more than anyone has, and a minute is what "I listened to it" means
 * whatever the length. A shorter song counts once all of it has been heard.
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
export const LISTENING_GAP_SECONDS = 2

/** How many seconds of this song have to be heard before it counts as a play. */
export function secondsToCount(duration: number): number {
  return Math.min(PLAY_COUNT_SECONDS, Math.max(0, duration))
}

/**
 * Whether this much listening is a play.
 *
 * Running to the end is not enough on its own: seeking to the end of a
 * twelve-minute song after three seconds "completed" it, and that counted as
 * a full play. What ran out is let off the last tick or so, which a player may
 * not have counted before the end came. Nothing heard is never a play — a song
 * that failed and was moved past "ended" too.
 */
export function countsAsPlay(heardSeconds: number, duration: number, completed: boolean): boolean {
  if (!(heardSeconds > 0)) return false
  const needed = secondsToCount(duration) - (completed ? LISTENING_GAP_SECONDS : 0)
  // A millisecond's grace: what was heard is sent in whole milliseconds.
  return heardSeconds >= needed - 0.001
}
