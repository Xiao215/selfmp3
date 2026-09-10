import { extrapolatePosition, type PlaybackState } from '@selfmp3/shared'

/**
 * Turning one device's reported state into playable arguments.
 *
 * Kept pure and separate from React because the awkward cases are all data
 * cases: a queue that was never populated, a `queueIndex` that disagrees with
 * `songId` because the heartbeat caught a track change mid-flight, or a state
 * that has been sitting on a sleeping phone for an hour. Getting any of those
 * wrong means a handoff starts the wrong song, which is exactly the kind of
 * bug that is miserable to reproduce with two real devices.
 */

export interface HandoffTarget {
  readonly queueIds: readonly number[]
  readonly index: number
  /** Seconds into `queueIds[index]`. */
  readonly position: number
}

/**
 * What to hand to `playQueue` to continue what `state` describes.
 *
 * `songId` is the authority on *what* is playing, not `queueIndex`: the index
 * is only meaningful against the queue it was captured with. When the two
 * disagree the song wins and the index is corrected; when the song is not in
 * the queue at all the queue is discarded and the song plays alone.
 */
export function handoffTarget(state: PlaybackState, now: number): HandoffTarget | null {
  if (state.songId === null) return null

  const position = Math.max(0, extrapolatePosition(state, now))
  const found = state.queueIds.indexOf(state.songId)

  if (found === -1) return { queueIds: [state.songId], index: 0, position }
  return { queueIds: state.queueIds, index: found, position }
}

/** "iPhone · Safari" → "iPhone". Enough to label a button without wrapping. */
export function shortDeviceName(name: string): string {
  const [first] = name.split('·')
  return (first ?? name).trim() || name
}
