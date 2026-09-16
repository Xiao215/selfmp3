import type { CoverSwatch, CoverTone } from './schemas/song.js'

/**
 * Which colour a cover is.
 *
 * The playing song's row and the player bars are drawn in it, so what is
 * playing looks like the music rather than like the app's own accent. The
 * server picks it once from each cover and sends it with the song; a browser
 * picks it from the image itself for a cover the server has not read yet. Both
 * use this, so a cover is the same colour whichever did the reading.
 *
 * The picking is plain arithmetic on a handful of pixels (the cover drawn at
 * 24×24), done in OKLCH so "the most vivid colour" means what the eye means by
 * it: pixels are grouped by hue, weighted by how colourful they are, and the
 * heaviest group wins. Near-black and near-white are ignored — a skyline
 * silhouette or a white border is not what a cover is "about".
 */

interface Oklch {
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
/** Unless what little there is agrees on a hue: this much, and this share of it in one bin. */
const MIN_SOFT_COLOURFULNESS = 0.012
const SOFT_MAJORITY = 0.4

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
    // Near-black and near-white are not the cover — a skyline, a border, the
    // black bars either side of square art in a video's frame — so they count
    // for nothing, not even towards how grey the cover is: counted before,
    // they made a soft-coloured cover letterboxed on black look like none.
    if (l < 0.2 || (l > 0.95 && c < 0.04)) continue
    counted++

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
  // Judged on all the colour in the cover, not the winning hue's share of it:
  // a cover split between green trees and a blue sky has plenty, spread over a
  // few bins, and was taken for grey.
  let colour = 0
  for (const binWeight of weight) colour += binWeight
  if (total === 0) return null
  const colourfulness = colour / counted
  // Little colour, but all of it one colour — beige paper, a sepia print — is
  // a colour, where the same little spread over every hue is a grey with noise.
  const soft = colourfulness >= MIN_SOFT_COLOURFULNESS && total / colour >= SOFT_MAJORITY
  if (colourfulness < MIN_COLOURFULNESS && !soft) return null

  const hue = ((Math.atan2(sinSum[best] ?? 0, cosSum[best] ?? 0) * 180) / Math.PI + 360) % 360
  // Chroma-weighted mean chroma: the vivid pixels of the winning hue decide.
  const palette = pickCoverPalette(pixels)
  return { hue, chroma: (chroma[best] ?? 0) / total, ...(palette.length > 0 ? { palette } : {}) }
}

/** How many colours a cover is summed up in. */
const PALETTE_SIZE = 6
const PALETTE_ROUNDS = 16
/** A colour that is less than this share of the cover is noise, not part of it. */
const PALETTE_MIN_SHARE = 0.02

/**
 * The handful of colours a cover is made of, most of the cover first.
 *
 * One hue says which colour a cover is; it cannot say that Genshin's cover is
 * green grass *and* a pink sky *and* blue water, and a visual drawn from the
 * grass alone went olive. So the pixels are grouped by how alike they look —
 * k-means in OKLab, where distance is what the eye sees — and each group keeps
 * its middle colour and its share. Every pixel counts here, dark ones too: the
 * deepest colour of a cover is what a visual's ground is made from.
 *
 * Deterministic, so the same cover always gives the same palette: the groups
 * start from pixels spread evenly through the cover sorted by lightness.
 */
export function pickCoverPalette(pixels: ArrayLike<number>): CoverSwatch[] {
  const points: [number, number, number][] = []
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if ((pixels[i + 3] ?? 0) < 128) continue
    const { l, c, h } = rgbToOklch(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0)
    const radians = (h * Math.PI) / 180
    points.push([l, c * Math.cos(radians), c * Math.sin(radians)])
  }
  if (points.length === 0) return []

  const k = Math.min(PALETTE_SIZE, points.length)
  const byLightness = [...points].sort((a, b) => a[0] - b[0])
  const centres = Array.from({ length: k }, (_, i) => [
    ...(byLightness[Math.floor(((i + 0.5) * byLightness.length) / k)] ?? [0, 0, 0]),
  ])
  const assigned = new Int32Array(points.length)
  for (let round = 0; round < PALETTE_ROUNDS; round++) {
    points.forEach((point, p) => {
      let nearest = 0
      let distance = Infinity
      centres.forEach((centre, c) => {
        const d =
          (point[0] - (centre[0] ?? 0)) ** 2 +
          (point[1] - (centre[1] ?? 0)) ** 2 +
          (point[2] - (centre[2] ?? 0)) ** 2
        if (d < distance) {
          distance = d
          nearest = c
        }
      })
      assigned[p] = nearest
    })
    const sums = centres.map(() => [0, 0, 0, 0])
    points.forEach((point, p) => {
      const sum = sums[assigned[p] ?? 0]
      if (!sum) return
      sum[0] = (sum[0] ?? 0) + point[0]
      sum[1] = (sum[1] ?? 0) + point[1]
      sum[2] = (sum[2] ?? 0) + point[2]
      sum[3] = (sum[3] ?? 0) + 1
    })
    sums.forEach((sum, c) => {
      const n = sum[3] ?? 0
      if (n > 0) centres[c] = [(sum[0] ?? 0) / n, (sum[1] ?? 0) / n, (sum[2] ?? 0) / n]
    })
  }

  const counts = new Array<number>(k).fill(0)
  for (const c of assigned) counts[c] = (counts[c] ?? 0) + 1
  const round3 = (value: number): number => Math.round(value * 1000) / 1000
  return centres
    .map((centre, c) => {
      const [l = 0, a = 0, b = 0] = centre
      return {
        l: round3(Math.max(0, Math.min(1, l))),
        c: round3(Math.hypot(a, b)),
        h: round3(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360),
        share: round3((counts[c] ?? 0) / points.length),
      }
    })
    .filter(swatch => swatch.share >= PALETTE_MIN_SHARE)
    .sort((x, y) => y.share - x.share)
}
