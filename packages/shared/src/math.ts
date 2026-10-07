/**
 * The two numeric helpers every package kept writing for itself — and, in one
 * folder, in two different argument orders. Here once, value first.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/** A day in milliseconds, for every "within the last N days" there is. */
export const DAY_MS = 24 * 60 * 60 * 1000
