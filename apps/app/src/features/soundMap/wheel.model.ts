/**
 * Whether a browser's wheel came from a mouse's wheel or a trackpad's two
 * fingers: both arrive as the same event. Over the sound map a mouse's wheel
 * zooms, as a map's does, and a trackpad's two fingers move it (Xiao,
 * 2026-10-27: scrolling a mouse moved the map up and down).
 */
export type WheelSource = 'mouse' | 'trackpad'

/** What a wheel event says, and when it came. */
interface WheelSample {
  readonly deltaX: number
  readonly deltaY: number
  /** 0 points, 1 lines, 2 pages. */
  readonly deltaMode: number
  /** Chrome's and Safari's older field, absent in Firefox. */
  readonly wheelDeltaY?: number
  readonly at: number
}

/** Wheels this close together are one gesture, and keep the source its first one had. */
const STREAM_MS = 200

/**
 * One notch of a mouse's wheel in Chrome and Safari on a Mac: a mouse with
 * the system's scroll acceleration moves by multiples of it.
 */
const MAC_NOTCH = 4.000244140625

/** A notch as a zoom takes it, in points: a Windows mouse's wheel moves 100 a notch. */
export const NOTCH_POINTS = 100

/**
 * Which it was. A gesture keeps the source it began with, so a trackpad's
 * quick flick, whose steps can be large, never turns into a zoom halfway.
 * Lines or pages are a mouse (Firefox); sideways movement is a trackpad, as
 * is the older field reading exactly three times the new one, which is how
 * Chrome and Safari send a trackpad's points; a Mac notch's multiple is a
 * mouse; what is left is a mouse when its steps are whole and large.
 */
export function wheelSource(
  sample: WheelSample,
  last: { readonly source: WheelSource; readonly at: number } | null,
): WheelSource {
  if (last && sample.at - last.at < STREAM_MS) return last.source
  if (sample.deltaMode !== 0) return 'mouse'
  if (sample.deltaX !== 0) return 'trackpad'
  const dy = Math.abs(sample.deltaY)
  if (sample.wheelDeltaY !== undefined && sample.wheelDeltaY !== 0) {
    if (Math.abs(sample.wheelDeltaY + 3 * sample.deltaY) < 3) return 'trackpad'
  }
  const notches = dy / MAC_NOTCH
  if (dy > 0 && Math.abs(notches - Math.round(notches)) < 1e-6) return 'mouse'
  return Number.isInteger(dy) && dy >= 50 ? 'mouse' : 'trackpad'
}

/** A mouse's movement in points, whatever unit it came in: one notch is `NOTCH_POINTS`. */
export function mousePoints(sample: Pick<WheelSample, 'deltaY' | 'deltaMode'>): number {
  if (sample.deltaMode === 1) return (sample.deltaY / 3) * NOTCH_POINTS
  if (sample.deltaMode === 2) return sample.deltaY * NOTCH_POINTS * 3
  const notches = sample.deltaY / MAC_NOTCH
  return Math.abs(notches - Math.round(notches)) < 1e-6 ? notches * NOTCH_POINTS : sample.deltaY
}
