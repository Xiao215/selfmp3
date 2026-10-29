import { hexToRgb, oklchToHex, type Rgb } from '@selfmp3/client'
import { clamp, clamp01, type CoverSwatch, type AudioFeatures, type Song } from '@selfmp3/shared'
import type { MotionSampler } from './motionSource.model'

/**
 * What a song with no lyrics shows where the words would be: Ripples, the
 * cover as a disc sending a ring out on each hit (docs/ui-mock `P24`).
 *
 * How it moves comes from the song's own tempo, energy, loudness, key and
 * cover colour, through the small functions below, which the browser's canvas
 * and the phone's views both draw from.
 *
 * "No lyrics" is one state. The lookup's saved answer that a song has no words
 * and a lookup that found nothing both end here; neither is called anything
 * in the app.
 */

/**
 * The cover's hue, pulled a little toward cool for a minor key and toward warm
 * for a major one — Camelot's "A" and "B". A nudge, not a repaint: the colour
 * still says which cover it came from.
 */
export const KEY_PULL = 20
const COOL_HUE = 250
const WARM_HUE = 45

export function keyedHue(hue: number, camelot: string | null | undefined): number {
  const mood = camelot?.endsWith('A') ? COOL_HUE : camelot?.endsWith('B') ? WARM_HUE : null
  const base = wrapHue(hue)
  if (mood === null) return base
  // The shorter way round the wheel, so 350° warms through 0°, not back through 180°.
  const toward = ((mood - base + 540) % 360) - 180
  return wrapHue(base + clamp(toward, -KEY_PULL, KEY_PULL))
}

/**
 * The colours a visual draws in: three light inks that glow on a dark ground,
 * a quarter turn apart, and the ground itself, in the song's own hue. The
 * ground stays dark in either theme, so the inks always have something to
 * glow against.
 */
export interface VisualColors {
  readonly inks: readonly [Rgb, Rgb, Rgb]
  /** The middle of the ground, then its edge. */
  readonly ground: readonly [Rgb, Rgb]
  /** Every ring's colour, where the rings are drawn in one rather than in turn in the inks. */
  readonly ring?: Rgb
}

/**
 * A cover with no colour in it: the visual in the cover's own greys, a touch
 * lighter for a light cover, and its rings in the accent (P6 A). It used to
 * invent a hue from the album's name, so a white cover drew green rings while
 * the page around it glowed grey; rows already wash such a cover in its grey
 * with the accent for their text.
 */
export function colourlessColors(palette: readonly CoverSwatch[], accent: Rgb): VisualColors {
  const share = palette.reduce((sum, swatch) => sum + swatch.share, 0)
  const lightness =
    share > 0 ? palette.reduce((sum, swatch) => sum + swatch.l * swatch.share, 0) / share : 0.5
  const grey = (l: number): Rgb => hexToRgb(oklchToHex(clamp(l, 0, 1), 0, 0))
  const lift = (lightness - 0.5) * 0.08
  return {
    inks: [grey(0.72 + lift), grey(0.62 + lift), grey(0.88 + lift)],
    ground: [grey(0.2), grey(0.1)],
    ring: accent,
  }
}

export function visualColors(
  hue: number,
  camelot: string | null | undefined,
  palette?: readonly CoverSwatch[] | null,
): VisualColors {
  if (palette) return paletteColors(palette, hue)
  const h = keyedHue(hue, camelot)
  const at = (lightness: number, chroma: number, turn: number): Rgb =>
    hexToRgb(oklchToHex(lightness, chroma, (h + turn + 360) % 360))
  return {
    inks: [at(0.78, 0.14, 0), at(0.72, 0.15, 32), at(0.84, 0.1, -28)],
    ground: [at(0.22, 0.05, 0), at(0.12, 0.03, 0)],
  }
}

/** Hues closer than this read as the same colour, so a palette's inks keep them apart. */
const INK_HUE_SPREAD = 35

const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)
const wrapHue = (h: number): number => ((h % 360) + 360) % 360

/**
 * A dark ground's hue, kept out of yellow-green. Between about 65° and 125°
 * a dark colour stops reading as a colour and reads as olive or khaki — the
 * muddy ground Genshin's grass gave — so it leans to a warm brown or a teal.
 */
export function groundHue(h: number): number {
  const hue = wrapHue(h)
  if (hue >= 65 && hue <= 125) return hue < 95 ? 40 : 160
  return hue
}

/**
 * The colours of a visual from the colours its cover is made of.
 *
 * Up to three distinct vivid colours from the cover become the inks — ranked
 * by how much of the cover they are, how colourful and how light, and kept
 * at least 35° apart — each lifted to the same brightness so they sit together
 * on the dark. The lead colour is the middle of the disc (`inks[2]`, the
 * lightest); the next two tint the halo, the washes and the rings (`inks[0]`,
 * `inks[1]`). The ground is the
 * cover's deepest colour, dark and quiet, steered out of the olive band. A
 * cover with fewer than three colours borrows its neighbours on the wheel.
 * The key does not pull the hues here: the cover's own colours already say
 * what the song looks like.
 */
function paletteColors(palette: readonly CoverSwatch[], leadHue: number): VisualColors {
  const vivid = palette
    .filter(swatch => swatch.c >= 0.02)
    .map(swatch => ({
      swatch,
      score: swatch.share * (swatch.c + 0.02) * (0.4 + Math.min(swatch.l, 0.8)),
    }))
    .sort((a, b) => b.score - a.score)
    .map(ranked => ranked.swatch)
  const hues: number[] = []
  for (const swatch of vivid) {
    if (hues.every(h => hueDistance(h, swatch.h) >= INK_HUE_SPREAD)) hues.push(swatch.h)
  }
  const lead = hues[0] ?? wrapHue(leadHue)
  const second = hues[1] ?? wrapHue(lead + 38)
  const third = hues[2] ?? wrapHue(lead - 38)
  const chromaFor = (h: number): number => {
    const near = vivid.find(swatch => hueDistance(swatch.h, h) < 20)
    return clamp((near ? near.c : 0.05) * 2.4, 0.1, 0.16)
  }
  const at = (lightness: number, chroma: number, h: number): Rgb =>
    hexToRgb(oklchToHex(lightness, chroma, h))

  const byDepth = [...palette].sort((a, b) => a.l - b.l)
  const deep = byDepth.find(swatch => swatch.c >= 0.015) ?? byDepth[0]
  const gh = groundHue(deep ? deep.h : 260)
  const gc = clamp((deep ? deep.c : 0.02) * 0.8, 0.015, 0.045)
  return {
    inks: [
      at(0.74, chromaFor(second), second),
      at(0.7, chromaFor(third), third),
      at(0.86, chromaFor(lead) * 0.8, lead),
    ],
    ground: [at(0.19, gc, gh), at(0.1, gc * 0.6, gh)],
  }
}

/** What either `SongVisual` twin draws from: the canvas in a browser, the views on a phone. */
export interface SongVisualProps {
  readonly song: Song
  /** What the visual follows: the sound, the song's curve, or its tempo (`useMotionSampler`). */
  readonly sampler: MotionSampler
  /** Round the corners, for a visual in a box rather than one filling the screen. */
  readonly rounded?: boolean
  /** The song's cover: Ripples' disc is the cover itself (docs/ui-mock `P24`). */
  readonly cover?: string | null
}

/** Ripples' disc across: P24's 230 on a 390-wide phone, and no more than half the shorter side. */
export function rippleDisc(width: number, height: number): number {
  return Math.min(width, height) * 0.5
}

/**
 * A ring's size, as a share of the disc, when it leaves (still hidden behind
 * the disc) and when it has faded at the edge of its reach.
 */
export const RING_FROM = 0.55
export const RING_TO = 2.3

/**
 * How Ripples looks at rest (P24), as both twins paint it: the phone's views
 * and the browser's canvas read these rather than each writing its own, which
 * is how the phone's ground came to stop at 70% of the box and the browser's
 * at three quarters of the longer side. Positions are shares of the visual's
 * width and height, reaches shares of its longer side unless said otherwise.
 */
export const RIPPLES_LOOK = {
  /** The ground's gradient, from its middle colour to its edge colour. */
  groundReach: 0.75,
  /** The first two inks washed faintly over opposite corners. */
  washes: [
    { x: 0.2, y: 0.18, reach: 0.6, ink: 0, alpha: 0.2 },
    { x: 0.82, y: 0.84, reach: 0.6, ink: 1, alpha: 0.16 },
  ],
  /**
   * The halo behind the disc, in the first ink: its radius a share of the
   * disc's width, solid to `solid` of that radius at `alpha`, then fading out.
   */
  halo: { reach: 0.95, solid: 0.4, alpha: 0.5, ink: 0 },
  /**
   * The disc's own colours, under the cover and for a song without one: a
   * light from up and to the left, as shares of the disc's width.
   */
  disc: {
    x: 0.42,
    y: 0.38,
    reach: 0.7,
    stops: [
      { at: 0, ink: 2 },
      { at: 0.7, ink: 0 },
      { at: 1, ink: 1 },
    ],
  },
} as const

/* ------------------------------------------------------------------ motion */

/** What a visual moves with, with a middling stand-in for anything not analysed. */
export interface VisualFeel {
  readonly bpm: number
  readonly energy: number
  /** 0–1 from the song's loudness: brightness breathes around it. */
  readonly loudness: number
}

export function visualFeel(features: AudioFeatures | null | undefined): VisualFeel {
  const bpm = features?.bpm
  return {
    // A tempo detector's half- and double-time answers stay in a drawable range.
    bpm: bpm == null ? 96 : clamp(bpm, 50, 200),
    energy: features?.energy ?? 0.45,
    loudness: loudnessLevel(features?.loudnessLufs ?? null),
  }
}

/** Integrated loudness from about −30 LUFS (quiet) to −6 (a loud master), as 0–1. */
export function loudnessLevel(lufs: number | null): number {
  if (lufs == null || !Number.isFinite(lufs)) return 0.5
  return clamp01((lufs + 30) / 24)
}

/** Where in the beat the song is, 0 at the beat to just under 1. */
export function beatPhase(seconds: number, bpm: number): number {
  const beats = (seconds * bpm) / 60
  return ((beats % 1) + 1) % 1
}

/**
 * The kick a beat gives: 1 on it, falling away quickly after. Only the tempo
 * stand-in uses it now (`beatSampler`); a song with a curve or a sound to
 * hear follows that instead.
 */
export function beatKick(phase: number): number {
  return Math.exp(-phase * 5)
}
