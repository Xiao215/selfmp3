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
  /** The mini player's first arrival of a session (`M1`, 3), and its sinking back when the queue empties. */
  rise: 320,
  /** Home's tiles, each one (`M1`, 4); `STAGGER_MS` apart. */
  arrive: 220,
  /** A sheet coming up from the foot, and going back down (`M2`, 3). */
  sheetUp: 300,
  sheetDown: 220,
  /** Up next's rail on a computer, sliding back out past the right edge (`M3`, 6). */
  railOut: 200,
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
  /** The player bar rising from the foot on a computer, once (`M3`, 1), and sinking when there is nothing to play. */
  barRise: 200,
  /** An iPad's stack sliding Now Playing up over the page (`M2`, 1); a phone's page rises on the spring and sinks over `sheetDown`. */
  nowPlaying: 380,
  /** A tag's or an artist's page coming in over the page that opened it (`M2`, 2). */
  place: 340,
  /** The cover shrinking while paused (`M1`, 5); it grows back on the spring. */
  breath: 400,
  /** The play glyph turning into pause, and back (`M1`, 2): half out, half in. */
  swap: 180,
  /** A computer's Now Playing settling in, and lifting away before the route changes (`M3`, 2). */
  stageEnter: 260,
  stageLeave: 180,
  /** The song visual fading into its new place as the stage becomes Focus. */
  stageVisual: 240,
  /** The cover and the words gliding between Stage and Focus. */
  stageMove: 520,
  /** The sidebar fading out as Now Playing arrives over it, and back. */
  sidebar: 160,
  /** How long the sidebar waits before coming back where the stack slides Now Playing away itself. */
  sidebarReturn: 300,
  /** The stage's chrome going while nothing moves, and coming back the moment a pointer does. */
  idleOut: 400,
  idleIn: 100,
  /** A hover caption fading up, and away. */
  tooltip: 120,
  /** How long a finger or a pointer rests on a row before the row lifts to be moved. */
  hold: 350,
  /** The least time a spinner stays once shown, so a short wait never flickers one. */
  busyHold: 300,
} as const

/**
 * When a pull on a sheet, or on Now Playing, lets go of it (`M2`, 3): past
 * this many points down, or flicked faster than this many points a second.
 */
export const PULL = { close: 120, flick: 900 } as const

/** Home's tiles arrive this far apart (`M1`, 4). */
export const STAGGER_MS = 60

/**
 * The most a whole row of arrivals may spread over. A welcome that keeps its
 * last tile waiting half a second has become a wait: a computer's grid of
 * nine closes up to fit.
 */
export const STAGGER_TOTAL_MS = 300

/** How far apart `count` arrivals are: `STAGGER_MS`, or closer for a long row. */
export function staggerStep(count: number): number {
  if (!Number.isFinite(count) || count <= 1) return STAGGER_MS
  return Math.min(STAGGER_MS, STAGGER_TOTAL_MS / (count - 1))
}

/** The stagger for the tile at `index`, one of `count`. */
export function staggerDelay(index: number, count: number = Infinity): number {
  return Math.max(0, index) * staggerStep(count)
}

/**
 * The app's ease-out as a browser writes it (`ui/motion.ts`'s `ease.out`),
 * for the few moves a browser makes itself: a row warming under a pointer, a
 * slider's thumb.
 */
export const EASE_OUT_CSS = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** `ease.in` as a browser writes it, for a browser's own exits. */
export const EASE_IN_CSS = 'cubic-bezier(0.4, 0, 1, 1)'

/** How far a pressed thing sinks (`M1`, "Press"): a control, and a row, which is wide enough that 0.96 would walk its ends. */
export const PRESS = { control: 0.96, row: 0.985 } as const

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
