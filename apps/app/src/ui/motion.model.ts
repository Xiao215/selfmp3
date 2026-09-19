/**
 * The arithmetic behind the app's moves (docs/ui-mock `M1`–`M3`), kept apart
 * from `motion.ts` so it can be tested without React Native: how long each move
 * takes, the curve that overshoots, how far apart a stagger is, what a session
 * remembers, and which rows make room for one being moved.
 */

/**
 * How long each move on the boards takes, in milliseconds. The fades that are
 * the same everywhere stay in `motion` (packages/client); these are the moves
 * that belong to one place.
 */
export const MOVE_MS = {
  /** The mini player's first arrival of a session (`M1`, 3). */
  rise: 320,
  /** Home's tiles, each one (`M1`, 4); `STAGGER_MS` apart. */
  arrive: 220,
  /** A sheet coming up from the foot, and going back down (`M2`, 3). */
  sheetUp: 300,
  sheetDown: 220,
  /** The tab bar's pill, and the page stepping in (`M2`, 4). */
  tab: 200,
  /** A playing row's wash coming in from the left (`M2`, 5). */
  wash: 260,
  /** A held queue row lifting, and its neighbours making room (`M2`, 6). */
  lift: 120,
  room: 180,
  /** A row's controls under a pointer, in and out (`M3`, 3). */
  hoverIn: 100,
  hoverOut: 140,
  /** A computer's page settling in, and the sidebar's highlight (`M3`, 5). */
  page: 180,
} as const

/** Home's tiles arrive this far apart (`M1`, 4). */
export const STAGGER_MS = 60

/**
 * The stagger for the tile at `index`, held to the first `cap` tiles: a
 * computer's grid of nine should not keep the last one waiting half a second.
 */
export function staggerDelay(index: number, step: number = STAGGER_MS, cap = 8): number {
  return Math.max(0, Math.min(index, cap)) * step
}

/**
 * A curve that runs a little past its end and settles back: Penner's "back
 * out". `s` sets how far past; 1.2 goes about five per cent over, which is the
 * mini player's few points on the board. As a plain function of time, so a
 * timed move can have a length the boards give and still overshoot.
 */
export function backOut(s: number): (t: number) => number {
  return t => {
    const u = t - 1
    return 1 + (s + 1) * u * u * u + s * u * u
  }
}

/** How far the rise and the sheet overshoot, as a curve. */
export const OVERSHOOT_S = 1.2

/** The highest value a curve reaches between 0 and 1, sampled. */
export function peakOf(curve: (t: number) => number, samples = 400): number {
  let peak = curve(0)
  for (let i = 1; i <= samples; i++) peak = Math.max(peak, curve(i / samples))
  return peak
}

/**
 * An interpolation for a move over `distance` points that overshoots by
 * `points`, whatever the distance: the curve's overshoot is a fraction of the
 * travel, and a sheet four hundred points tall would otherwise bounce twenty.
 * The part of the curve past 1 is mapped onto the few points instead.
 */
export function overshootRange(
  distance: number,
  points: number,
  peak: number = OVERSHOOT_PEAK,
): { inputRange: number[]; outputRange: number[] } {
  return { inputRange: [0, 1, peak], outputRange: [distance, 0, -points] }
}

/** The peak of the curve every overshooting move uses. */
export const OVERSHOOT_PEAK = peakOf(backOut(OVERSHOOT_S))

/**
 * What a session has already shown once: the mini player's rise, Home's
 * tiles. Module-level in the app, so a tab switch or a remount does not play
 * them again; a fresh launch does.
 */
interface SessionMemory {
  /** True the first time `key` is asked for, false every time after. */
  readonly first: (key: string) => boolean
  /** Whether `key` has been shown, without claiming it. */
  readonly seen: (key: string) => boolean
  /** Lets `key` play again: the mini player, once the queue has emptied. */
  readonly forget: (key: string) => void
}

export function sessionMemory(): SessionMemory {
  const shown = new Set<string>()
  return {
    first: key => {
      if (shown.has(key)) return false
      shown.add(key)
      return true
    },
    seen: key => shown.has(key),
    forget: key => void shown.delete(key),
  }
}

/**
 * Which way a row steps while another is carried past it (`M2`, 6): up one
 * row when the carried row came from above it and is now at or below it, down
 * one when it came from below and is now at or above it, and still otherwise.
 * The carried row itself follows the finger, not this.
 */
export function roomShift(index: number, from: number, over: number): -1 | 0 | 1 {
  if (index === from) return 0
  if (from < index && index <= over) return -1
  if (over <= index && index < from) return 1
  return 0
}
