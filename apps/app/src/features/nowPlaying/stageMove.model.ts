import type { StageGeometry } from './nowPlaying.model'

/**
 * The glide between Now Playing's two modes on a computer, as numbers.
 *
 * Nothing laid out moves. Each piece is laid out once, where its mode puts
 * it, and moved there with a transform and an opacity, which a browser and a
 * phone's native driver can both run without asking React.
 *
 * Animating the layout instead — the cover's left, top, width, height and
 * corners, the lyrics column's left and right — is a React render per frame
 * with new plain numbers, and Unistyles turns each new style into a new class
 * and rewrites its whole stylesheet to add it: hundreds of full-sheet rewrites
 * in half a second, with every lyric line re-wrapping at each new width.
 *
 * `m` is how far through the move: 0 is the stage, 1 is Focus.
 */

export const MOVE_MS = 520
/** The move's curve, as the four numbers of a cubic bézier. */
export const MOVE_EASING = [0.2, 0.8, 0.2, 1] as const

/** Where the stage puts the top of its cover. */
export const COVER_TOP = 84
/** The cover in Focus: a thumbnail in the header, beside the chevron. */
const FOCUS_COVER = { left: 64, top: 10, size: 40 } as const
const COVER_RADIUS = { stage: 12, focus: 6 } as const

/**
 * A piece of the page part-way through the move. Anything left out stays as
 * the piece's own style has it.
 */
export interface MovePose {
  readonly translateX?: number
  readonly translateY?: number
  readonly scale?: number
  readonly opacity?: number
  /**
   * The corners as they are seen. A scale shrinks corners with everything
   * else, so the radius laid out is this divided by the scale.
   */
  readonly radius?: number
}

/**
 * A pose for every point of the move. On a phone the native driver can only
 * run straight lines between the two ends, so everything but `radius` must be
 * linear in `m`; the radius is seen linearly and divided by the scale.
 */
export type PoseAt = (m: number) => MovePose

const lerp = (from: number, to: number, m: number): number => from + (to - from) * m

/**
 * The cover, laid out at the stage's size and place and shrunk into the
 * header. A scale holds the centre still, so the move is centre to centre;
 * that makes the cover's edges travel exactly as the animated left, top and
 * width did.
 */
export function coverPose(g: StageGeometry, m: number): MovePose {
  const half = g.cover / 2
  const focusHalf = FOCUS_COVER.size / 2
  return {
    translateX: (FOCUS_COVER.left + focusHalf - (g.pad + half)) * m,
    translateY: (FOCUS_COVER.top + focusHalf - (COVER_TOP + half)) * m,
    scale: lerp(1, FOCUS_COVER.size / g.cover, m),
    radius: lerp(COVER_RADIUS.stage, COVER_RADIUS.focus, m),
  }
}

interface WordsFrame {
  readonly left: number
  readonly right: number
  readonly top: number
}

/** Where the lyrics column's edges are, `m` of the way from the stage to Focus. */
export function wordsFrame(width: number, g: StageGeometry, m: number): WordsFrame {
  return {
    left: lerp(g.pad + g.cover + g.gutter, width * 0.12, m),
    right: lerp(g.right, width * 0.12, m),
    top: lerp(60, 56, m),
  }
}

/**
 * The lyrics column, laid out where its mode puts it and slid there from where
 * the other mode had it. Its width is the mode's from the first frame, so the
 * lines wrap once rather than at every step; its left edge and top travel as
 * they did.
 */
export function wordsPose(width: number, g: StageGeometry, focus: boolean, m: number): MovePose {
  const at = wordsFrame(width, g, m)
  const laidOut = wordsFrame(width, g, focus ? 1 : 0)
  return { translateX: at.left - laidOut.left, translateY: at.top - laidOut.top }
}

/** The corner radius to lay out for a pose, so that it is seen at `radius` once scaled. */
export function laidOutRadius(pose: MovePose): number | undefined {
  return pose.radius === undefined ? undefined : pose.radius / (pose.scale ?? 1)
}

/** A pose as CSS, for a browser's own animation. */
type MoveKeyframe = {
  offset: number
  transform?: string
  opacity?: number
  borderRadius?: string
}

/** Straight lines need two keyframes; a radius under a changing scale bends, so it gets more. */
const RADIUS_SAMPLES = 9

/**
 * A browser animation's keyframes for a move from `from` to `to`.
 *
 * The curve is the animation's own easing, applied before the keyframes are
 * read, so evenly spaced keyframes along `m` land where Animated's did.
 */
export function moveKeyframes(pose: PoseAt, from: number, to: number): MoveKeyframe[] {
  const samples = pose(from).radius === undefined ? 2 : RADIUS_SAMPLES
  return Array.from({ length: samples }, (_, step) => {
    const offset = step / (samples - 1)
    const at = pose(lerp(from, to, offset))
    const frame: MoveKeyframe = { offset, transform: transformCss(at) }
    if (at.opacity !== undefined) frame.opacity = at.opacity
    const radius = laidOutRadius(at)
    if (radius !== undefined) frame.borderRadius = `${radius}px`
    return frame
  })
}

/** The same order as React Native's transform array: translate, then scale about the centre. */
function transformCss(pose: MovePose): string {
  return `translateX(${pose.translateX ?? 0}px) translateY(${pose.translateY ?? 0}px) scale(${pose.scale ?? 1})`
}
