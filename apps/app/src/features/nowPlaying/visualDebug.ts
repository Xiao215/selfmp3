import type { MotionCurveLike } from './motionSource.model'

/**
 * A way to watch the visuals follow the music from a test, and to force the
 * stored-curve path in a browser that could listen.
 *
 * Inert unless something set `globalThis.__selfmp3VisualDebug` before the app
 * loaded (a Playwright init script does): nobody using the app ever has it,
 * and nothing is recorded or changed without it. With it, each drawn frame
 * appends what the sampler said and what the style did with it, and a `curve`
 * on it (plain arrays are fine) replaces the song's own, skipping the
 * analyser, so a synthetic curve can prove the curve path in Chromium.
 */

interface VisualDebugFrame {
  /** The playhead, seconds. */
  t: number
  source: string
  kind: string
  level: number
  onset: number
  glow: number
  fired: boolean
  rings: number
  /** The live sampler's raw numbers, before they become a level and an onset. */
  rms?: number
  flux?: number
}

interface VisualDebug {
  frames?: VisualDebugFrame[]
  curve?: {
    rate: number
    duration: number
    loudness: ArrayLike<number>
    onset: ArrayLike<number>
  }
}

function debugObject(): VisualDebug | null {
  const value = (globalThis as { __selfmp3VisualDebug?: unknown }).__selfmp3VisualDebug
  return value && typeof value === 'object' ? (value as VisualDebug) : null
}

let forced: { from: unknown; curve: MotionCurveLike } | null = null

/** The curve a test put in place of the song's own, or null. */
export function debugCurve(): MotionCurveLike | null {
  const given = debugObject()?.curve
  if (!given) return null
  if (forced?.from === given) return forced.curve
  const curve: MotionCurveLike = {
    rate: given.rate,
    duration: given.duration,
    loudness: Uint8Array.from(given.loudness),
    onset: Uint8Array.from(given.onset),
  }
  forced = { from: given, curve }
  return curve
}

const KEEP = 4000

/** Records one drawn frame, when a test is watching. */
export function recordVisualFrame(frame: VisualDebugFrame): void {
  const debug = debugObject()
  if (!debug) return
  const frames = (debug.frames ??= [])
  frames.push(frame)
  if (frames.length > KEEP) frames.splice(0, frames.length - KEEP)
}
