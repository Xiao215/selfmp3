import {
  featureDistance,
  transitionCrossfade,
  type FeatureWeights,
  type Song,
  type SongFeatures,
} from '@selfmp3/shared'
import type { QueueState } from './queue.js'

/**
 * Auto-mix: reorder what is coming up into a smooth path.
 *
 * Pure functions in the same spirit as `queue.ts`. Given the current song,
 * the upcoming queue is walked greedily — always to the nearest neighbour by
 * tempo, key and energy — so each transition is as gentle as the remaining
 * songs allow. Greedy is not optimal, but a queue is short and a listener
 * hears one transition at a time; a perfect tour is not worth the code.
 */

/** Loudness matters less here than for "similar": a fade hides a level gap. */
const MIX_WEIGHTS: FeatureWeights = { bpm: 1, energy: 1, loudness: 0.25, key: 1 }

/** Crossfade used when the user has crossfade switched off but auto-mix on. */
export const AUTO_MIX_DEFAULT_CROSSFADE = 4

/**
 * Order `ids` as a path starting nearest to `fromId`.
 *
 * Songs without features cannot be placed sensibly, so they keep their
 * original relative order at the end rather than being scattered by the
 * "unknown" penalty.
 */
export function orderPath(
  fromId: number | undefined,
  ids: readonly number[],
  byId: ReadonlyMap<number, Song>,
): number[] {
  const featuresOf = (id: number): SongFeatures | null => byId.get(id)?.features ?? null

  const analysed: number[] = []
  const unknown: number[] = []
  for (const id of ids) (featuresOf(id) ? analysed : unknown).push(id)
  if (analysed.length < 2) return [...analysed, ...unknown]

  const remaining = [...analysed]
  const path: number[] = []
  let cursor = fromId === undefined ? null : featuresOf(fromId)

  // With nothing playing, start from the first queued song rather than
  // inventing an anchor.
  if (cursor === null) {
    const first = remaining.shift()
    if (first === undefined) return [...unknown]
    path.push(first)
    cursor = featuresOf(first)
  }

  while (remaining.length > 0) {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const distance = featureDistance(cursor, featuresOf(remaining[i] ?? -1), MIX_WEIGHTS)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
      }
    }
    const [next] = remaining.splice(bestIndex, 1)
    if (next === undefined) break
    path.push(next)
    cursor = featuresOf(next)
  }

  return [...path, ...unknown]
}

/** Reorder everything after the current track; played history is untouched. */
export function autoMixOrder(state: QueueState, byId: ReadonlyMap<number, Song>): QueueState {
  if (state.items.length < 3) return state
  const start = Math.max(0, state.index)
  const head = state.items.slice(0, start + 1)
  const upcoming = state.items.slice(start + 1)
  if (upcoming.length < 2) return state

  const ordered = orderPath(state.items[start], upcoming, byId)
  const unchanged = ordered.every((id, i) => id === upcoming[i])
  if (unchanged) return state
  return { ...state, items: [...head, ...ordered] }
}

/**
 * The crossfade for the next handover.
 *
 * Bounded by the user's own crossfade setting; with it switched off, a
 * modest fixed fade is used so auto-mix still mixes.
 */
export function autoMixCrossfade(
  current: Song | null,
  next: Song | null,
  userCrossfadeSeconds: number,
): number {
  const max = userCrossfadeSeconds > 0 ? userCrossfadeSeconds : AUTO_MIX_DEFAULT_CROSSFADE
  return transitionCrossfade(current?.features ?? null, next?.features ?? null, max)
}
