import type { SongFeatures } from '@selfmp3/shared'

/**
 * What a song with no words shows instead of lyrics.
 *
 * Two layers, kept apart on purpose. *Which* visual a song gets is picked from
 * its analysed energy (`autoVisual`), so a nocturne and a big-band chase do
 * not get the same one. *How* that visual moves comes from the song's own
 * tempo, energy and cover colours, in `visualDraw.ts`. Anyone who disagrees
 * with the pick can choose another for that song, and the choice is kept on
 * this device.
 */

export type VisualKind = 'pulse' | 'aurora' | 'ring' | 'ridges'

export const VISUAL_NAMES: Record<VisualKind, string> = {
  pulse: 'Pulse',
  aurora: 'Aurora',
  ring: 'Spectrum ring',
  ridges: 'Ridgelines',
}

/** The two that need to hear the music; the rest draw from the analysis alone. */
export const LIVE_VISUALS: ReadonlySet<VisualKind> = new Set(['ring', 'ridges'])

/** Below this a song has no beat worth showing. */
export const CALM_ENERGY = 0.35
/** At or above this the sound itself is the show — where it can be heard. */
export const BUSY_ENERGY = 0.7

/**
 * The visual a song gets when nobody has chosen one.
 *
 * A song not analysed yet gets Aurora: it needs nothing but the cover.
 * Ridgelines is never picked automatically — it is striking but closer to a
 * screensaver than to the song, so it plays only when chosen.
 */
export function autoVisual(features: SongFeatures | null, canHear: boolean): VisualKind {
  const energy = features?.energy
  if (energy == null || energy < CALM_ENERGY) return 'aurora'
  if (energy >= BUSY_ENERGY && canHear) return 'ring'
  return 'pulse'
}

/**
 * Whether this browser may route playback through Web Audio.
 *
 * Not on a phone or tablet: a locked screen suspends Web Audio, and a song
 * routed through it stops with it — background play matters far more than a
 * spectrum. Not in Safari either, which has a history of ignoring the
 * element's volume once it is routed, and the crossfade is made of volume.
 */
export function canHearMusic(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!('AudioContext' in window)) return false
  const ua = navigator.userAgent
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const apple =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|Firefox\//.test(ua)
  return !touch && !apple && !/Android/.test(ua) && !safari
}

/* --------------------------------------------------------------- choices */

const CHOICES_KEY = 'selfmp3:visuals'

type Choices = Record<string, VisualKind>

function readChoices(): Choices {
  try {
    const raw = localStorage.getItem(CHOICES_KEY)
    return raw ? (JSON.parse(raw) as Choices) : {}
  } catch {
    return {}
  }
}

export function chosenVisual(songId: number): VisualKind | null {
  const choice = readChoices()[String(songId)]
  return choice && choice in VISUAL_NAMES ? choice : null
}

/** `null` goes back to the automatic pick. */
export function setChosenVisual(songId: number, kind: VisualKind | null): void {
  const choices = readChoices()
  if (kind === null) delete choices[String(songId)]
  else choices[String(songId)] = kind
  try {
    localStorage.setItem(CHOICES_KEY, JSON.stringify(choices))
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
}

/* --------------------------------------------------------------- colours */

export type Rgb = readonly [number, number, number]

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

/** A stable palette for a song without art, matching `Cover`'s placeholder hue. */
export function placeholderPalette(songId: number): [Rgb, Rgb, Rgb] {
  const hue = (songId * 137.508) % 360
  return [
    hslToRgb(hue, 0.55, 0.62),
    hslToRgb((hue + 45) % 360, 0.5, 0.55),
    hslToRgb((hue + 45) % 360, 0.45, 0.16),
  ]
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
