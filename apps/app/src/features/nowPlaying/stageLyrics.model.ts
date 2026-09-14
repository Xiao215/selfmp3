/**
 * How each lyric line is drawn, with nothing drawn: its tone against the line
 * being sung, and in Focus how blurred it is.
 *
 * Kept out of the view so that a line's look is a few plain values — a line
 * whose values did not change is not drawn again when the song moves on.
 */

/** How a line reads: the sung one, one under the mouse, one sung already, one to come. */
export type LineTone = 'plain' | 'active' | 'hovered' | 'past' | 'future'

export function lineTone(
  index: number,
  active: number,
  hovered: number | null,
  synced: boolean,
): LineTone {
  if (!synced) return 'plain'
  if (index === active) return 'active'
  if (hovered === index) return 'hovered'
  return index < active ? 'past' : 'future'
}

/** Blur per line of distance from the sung one, up to three lines. */
const BLUR_PER_LINE = 0.7
const BLUR_LINES = 3
/**
 * A line's height in ems at its smallest: its line height and the padding
 * above and below it. Romanization and wrapping only make lines taller.
 */
const LINE_EMS = 1.25 + 0.28 * 2

/**
 * How many lines from the sung one can be on screen at all: as many as the
 * box holds at their shortest. Past that a line is scrolled out of sight, and
 * a blur there is a filter the browser keeps for nothing.
 */
export function blurReach(boxHeight: number, fontSize: number): number {
  return Math.ceil(boxHeight / (fontSize * LINE_EMS)) + 1
}

/**
 * The blur on a line in Focus, in pixels: none on the sung line, more for each
 * line away from it up to three, and none past `reach`, where it cannot be
 * seen.
 */
export function lyricBlur(index: number, active: number, reach: number): number {
  const distance = Math.abs(index - active)
  if (distance === 0 || distance > reach) return 0
  return Math.min(BLUR_LINES, distance) * BLUR_PER_LINE
}
