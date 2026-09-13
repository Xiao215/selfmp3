import { advance, type QueueState } from '@selfmp3/shared'

/**
 * Moving through a queue past songs that cannot play on this device.
 *
 * The queue's own rules (`advance` in packages/shared) know nothing about
 * downloads. A song not on the phone, offline or with streaming off, would be
 * loaded and sit paused with no word — so when the queue moves on, by itself
 * or from Next, it moves on past those, and stops if none of the rest can play.
 *
 * Starting a song by hand is not this: that says why it cannot play
 * (`playBlock`).
 */
export function advancePlayable(
  state: QueueState,
  auto: boolean,
  canPlay: (songId: number) => boolean,
): { state: QueueState; stop: boolean } {
  let result = advance(state, auto)
  // Each step moves one place, so one lap of the queue is enough to know.
  for (let steps = 0; !result.stop && steps < state.items.length; steps++) {
    const songId = result.state.items[result.state.index]
    if (songId === undefined || canPlay(songId)) return result
    // Repeat-one on a song that cannot play would go round forever.
    if (result.state.repeat === 'one' && result.state.index === state.index) {
      return { state: result.state, stop: true }
    }
    result = advance(result.state, auto)
  }
  return { state: result.state, stop: true }
}

/** The song to preload next, skipping ones that cannot play; null at the end. */
export function peekPlayable(
  state: QueueState,
  canPlay: (songId: number) => boolean,
): number | null {
  const { state: next, stop } = advancePlayable(state, true, canPlay)
  return stop ? null : (next.items[next.index] ?? null)
}
