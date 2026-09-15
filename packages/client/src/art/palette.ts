/**
 * The colours a cover lends the page around it.
 *
 * Now Playing lights its background with three colours from the artwork, so
 * every song's page looks like that song. Working the colours out is plain
 * arithmetic on pixels, shared here; reading the pixels is not, and is done by
 * whichever platform can (a canvas on the web) — so every client lights the
 * same cover the same way.
 */

import type { CoverTone } from '@selfmp3/shared'
import { oklchToHex } from '../theme/oklch.js'

export type Rgb = readonly [number, number, number]
export type Palette = readonly [Rgb, Rgb, Rgb]

/**
 * Three colours that say "this cover", from a thumbnail's pixels.
 *
 * Pixels are sorted into twelve hue buckets and each bucket is weighted by how
 * much of the cover it covers and how colourful it is, so a small red sign on
 * a grey street can still win over the grey. Near-black, near-white and grey
 * pixels only count if the whole cover is like that. The third colour is the
 * darkest of the picks, pushed darker, for the ground.
 */
export function paletteFromPixels(rgba: ArrayLike<number>): [Rgb, Rgb, Rgb] | null {
  interface Bucket {
    weight: number
    r: number
    g: number
    b: number
    n: number
  }
  const buckets: Bucket[] = Array.from({ length: 13 }, () => ({
    weight: 0,
    r: 0,
    g: 0,
    b: 0,
    n: 0,
  }))

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3] ?? 0
    if (alpha < 128) continue
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    const [hue, saturation, lightness] = rgbToHsl(r, g, b)
    const colourful = saturation > 0.18 && lightness > 0.12 && lightness < 0.92
    // Bucket 12 holds the greys, blacks and whites.
    const index = colourful ? Math.floor(hue / 30) % 12 : 12
    const bucket = buckets[index]
    if (!bucket) continue
    bucket.weight += colourful ? 0.4 + saturation : 0.15
    bucket.r += r
    bucket.g += g
    bucket.b += b
    bucket.n += 1
  }

  const ranked = buckets
    .filter(bucket => bucket.n > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((bucket): Rgb => [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n])

  const first = ranked[0]
  if (!first) return null
  const second = ranked[1] ?? shiftLightness(first, 0.15)
  const darkest = [first, second, ranked[2] ?? first].reduce((a, b) =>
    luminance(a) <= luminance(b) ? a : b,
  )
  return [liftForDark(first), liftForDark(second), deepen(darkest)]
}

/**
 * The palette for a song before its cover is read, or with no cover at all:
 * the hue its letter tile already uses, so the page never flashes a colour it
 * then drops.
 */
export function placeholderPalette(songId: number): [Rgb, Rgb, Rgb] {
  const hue = (songId * 137.508) % 360
  return [
    hslToRgb(hue, 0.55, 0.62),
    hslToRgb((hue + 45) % 360, 0.5, 0.55),
    hslToRgb((hue + 45) % 360, 0.45, 0.16),
  ]
}

/**
 * A palette in the cover's own hue, before the cover has been read.
 *
 * The server sends a song's tone with the song, so this is ready on the first
 * frame; the three sampled colours replace it once the pixels are in. Built
 * like `placeholderPalette` — a glow, a second glow turned 45°, and a dark
 * ground — so the swap moves shades, not hues.
 */
export function tonePalette({ hue, chroma }: CoverTone): [Rgb, Rgb, Rgb] {
  const c = Math.min(Math.max(chroma, 0.06), 0.16)
  return [
    hexToRgb(oklchToHex(0.72, c, hue)),
    hexToRgb(oklchToHex(0.64, c * 0.9, (hue + 45) % 360)),
    hexToRgb(oklchToHex(0.28, c * 0.7, (hue + 45) % 360)),
  ]
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb
}

export const rgba = ([r, g, b]: Rgb, alpha: number): string =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`

/* The page is dark, so the glow colours must be light enough to glow. */
function liftForDark(colour: Rgb): Rgb {
  const [h, s, l] = rgbToHsl(...colour)
  return hslToRgb(h, Math.min(0.85, s), Math.max(0.5, Math.min(0.78, l)))
}

/* A ground has to stay dark whatever the cover is, so it gets a ceiling, not an offset. */
function deepen(colour: Rgb): Rgb {
  const [h, s, l] = rgbToHsl(...colour)
  return hslToRgb(h, Math.min(0.6, s), Math.min(0.2, l * 0.4))
}

function shiftLightness(colour: Rgb, delta: number): Rgb {
  const [h, s, l] = rgbToHsl(...colour)
  return hslToRgb(h, s, Math.max(0.06, Math.min(0.9, l + delta)))
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
