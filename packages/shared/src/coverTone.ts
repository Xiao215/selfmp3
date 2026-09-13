import type { CoverTone } from './schemas/song.js'

/**
 * Which colour a cover is.
 *
 * The playing song's row and the player bars are drawn in it, so what is
 * playing looks like the music rather than like the app's own accent. The
 * server picks it once from each cover and sends it with the song; a browser
 * talking to an older server can still pick it from the image itself. Both use
 * this, so a cover is the same colour whichever did the reading.
 *
 * The picking is plain arithmetic on a handful of pixels (the cover drawn at
 * 24×24), done in OKLCH so "the most vivid colour" means what the eye means by
 * it: pixels are grouped by hue, weighted by how colourful they are, and the
 * heaviest group wins. Near-black and near-white are ignored — a skyline
 * silhouette or a white border is not what a cover is "about".
 *
 * Moved from the web app's `lib/coverColor.ts`, unchanged.
 */

export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
}

function toLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB (0–255) to OKLCH, per Björn Ottosson's reference matrices. */
export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return {
    l: L,
    c: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  }
}

const HUE_BINS = 24
/** Below this much total colour the cover is effectively grey. */
const MIN_COLOURFULNESS = 0.02

/**
 * The cover's colour from RGBA pixels, or null for a cover with no real
 * colour in it (black and white photography, a grey placeholder).
 */
export function pickCoverTone(pixels: ArrayLike<number>): CoverTone | null {
  const weight = new Float64Array(HUE_BINS)
  const chroma = new Float64Array(HUE_BINS)
  const sinSum = new Float64Array(HUE_BINS)
  const cosSum = new Float64Array(HUE_BINS)
  let counted = 0

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue
    const { l, c, h } = rgbToOklch(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0)
    counted++
    if (l < 0.2 || (l > 0.95 && c < 0.04)) continue

    const bin = Math.floor((h / 360) * HUE_BINS) % HUE_BINS
    const radians = (h * Math.PI) / 180
    weight[bin] = (weight[bin] ?? 0) + c
    chroma[bin] = (chroma[bin] ?? 0) + c * c
    sinSum[bin] = (sinSum[bin] ?? 0) + Math.sin(radians) * c
    cosSum[bin] = (cosSum[bin] ?? 0) + Math.cos(radians) * c
  }

  if (counted === 0) return null

  let best = 0
  for (let bin = 1; bin < HUE_BINS; bin++) {
    if ((weight[bin] ?? 0) > (weight[best] ?? 0)) best = bin
  }

  const total = weight[best] ?? 0
  if (total / counted < MIN_COLOURFULNESS) return null

  const hue = ((Math.atan2(sinSum[best] ?? 0, cosSum[best] ?? 0) * 180) / Math.PI + 360) % 360
  // Chroma-weighted mean chroma: the vivid pixels of the winning hue decide.
  return { hue, chroma: (chroma[best] ?? 0) / total }
}
