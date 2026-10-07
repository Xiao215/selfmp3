import { oklchToHex } from '@selfmp3/client'
import { clamp, clamp01 } from '@selfmp3/shared'

/**
 * A slider's arithmetic, shared by both of its drawings: where along the track
 * a value sits, and which value a point on the track means — and the colours
 * of the rainbow track the accent is chosen from.
 */

interface SliderRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

/** The value at a fraction of the way along, snapped to the step. */
export function valueAt(fraction: number, { min, max, step }: SliderRange): number {
  const clamped = clamp01(fraction)
  const raw = min + clamped * (max - min)
  const snapped = min + Math.round((raw - min) / step) * step
  // Steps like 0.05 leave float dust (0.30000000000000004); four places is plenty.
  return Number(clamp(snapped, min, max).toFixed(4))
}

/** How far along the track a value sits, 0 to 1. */
export function fractionOf(value: number, { min, max }: SliderRange): number {
  if (max <= min) return 0
  return clamp01((value - min) / (max - min))
}

/**
 * The rainbow track's stops, worked out once. The track does not follow the
 * accent — it is what the accent is being chosen from — so these are the same
 * seven colours on every frame of a drag.
 */
export const HUE_STOPS: readonly { readonly hue: number; readonly color: string }[] = [
  0, 60, 120, 180, 240, 300, 360,
].map(hue => ({ hue, color: oklchToHex(0.72, 0.16, hue) }))

/** What a screen reader can do to a slider or the seek bar: a step either way. */
export const ADJUST_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }] as const
