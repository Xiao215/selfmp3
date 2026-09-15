/**
 * Practice helpers: pure functions behind the A–B loop and count-in, shared so
 * every platform's practice panel behaves the same.
 *
 * The engine owns the actual loop; these decide what the loop *should* be
 * from what the user tapped, and what the UI should draw for it.
 */

/**
 * The speeds there are, everywhere: the practice panel is speed's one home
 * (the player bar's own speed menu went, 2026-09-14), so this list runs from
 * learning a passage slowly to getting through a podcast.
 */
export const PRACTICE_SPEEDS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2] as const

/** One beat at the song's tempo, or half a second when the tempo is unknown. */
export const DEFAULT_COUNT_IN_MS = 500

export function countInMs(bpm: number | null | undefined): number {
  if (bpm === null || bpm === undefined || !(bpm > 0)) return DEFAULT_COUNT_IN_MS
  return Math.round(60_000 / bpm)
}

export interface LoopRegion {
  readonly left: number
  readonly width: number
}

/**
 * Where to draw the loop on a progress bar, as percentages of its width.
 *
 * With only A set the region is a hairline at A, so the user can see the
 * first tap registered before choosing B.
 */
export function loopRegionPercent(
  a: number | null,
  b: number | null,
  duration: number,
): LoopRegion | null {
  if (a === null || !(duration > 0)) return null
  const start = clamp(a / duration, 0, 1)
  if (b === null) return { left: percent(start), width: 0 }
  const end = clamp(b / duration, 0, 1)
  const [lo, hi] = start <= end ? [start, end] : [end, start]
  return { left: percent(lo), width: percent(hi - lo) }
}

/** A CSS percentage. Rounded because 90 % + 10 % of a bar should still be 100. */
function percent(fraction: number): number {
  return Math.round(fraction * 100 * 1e6) / 1e6
}

/**
 * The next loop state after tapping "A" or "B" at `now`.
 *
 * Tapping A with a loop already running moves A; tapping B before A treats
 * the tap as A, since a loop needs a start before it needs an end.
 */
export function tapLoop(
  which: 'A' | 'B',
  now: number,
  current: { a: number | null; b: number | null },
): { a: number | null; b: number | null } {
  const time = Math.max(0, now)
  if (which === 'A') return { a: time, b: current.b }
  if (current.a === null) return { a: time, b: null }
  return { a: current.a, b: time }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
