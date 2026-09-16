/**
 * A slider's arithmetic, shared by both of its drawings: where along the track
 * a value sits, and which value a point on the track means.
 */

interface SliderRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

/** The value at a fraction of the way along, snapped to the step. */
export function valueAt(fraction: number, { min, max, step }: SliderRange): number {
  const clamped = Math.max(0, Math.min(1, fraction))
  const raw = min + clamped * (max - min)
  const snapped = min + Math.round((raw - min) / step) * step
  // Steps like 0.05 leave float dust (0.30000000000000004); four places is plenty.
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(4))
}

/** How far along the track a value sits, 0 to 1. */
export function fractionOf(value: number, { min, max }: SliderRange): number {
  if (max <= min) return 0
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}
