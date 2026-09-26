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
