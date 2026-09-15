import { oklchToHex, type Rgb } from '@selfmp3/client'
import type { CoverSwatch, SongFeatures } from '@selfmp3/shared'

/**
 * What a song with no lyrics shows where the words would be: the rules, with
 * nothing drawn.
 *
 * Two layers, kept apart on purpose, as the old web app kept them. *Which*
 * visual a song gets is picked from how it sounds (`autoVisual`), so a
 * nocturne and a big-band chase do not get the same one. *How* that visual
 * moves comes from the song's own tempo, energy, loudness, key and cover
 * colour, through the small functions below, which the browser's canvas and
 * the phone's views both draw from. Anyone who disagrees with the pick can
 * choose another for that song, and the choice is kept on this device.
 *
 * "No lyrics" is one state. The lookup's saved answer that a song has no words
 * and a lookup that found nothing both end here; neither is called anything
 * in the app.
 */

export type VisualKind = 'aurora' | 'pulse' | 'spectrum' | 'drift'

export const VISUAL_KINDS: readonly VisualKind[] = ['aurora', 'pulse', 'spectrum', 'drift']

export const VISUAL_NAMES: Record<VisualKind, string> = {
  aurora: 'Aurora',
  pulse: 'Pulse',
  spectrum: 'Spectrum',
  drift: 'Drift',
}

/** Below this a song is calm: slow bands suit it better than any beat. */
export const CALM_ENERGY = 0.35
/** At or above this the sound itself is the show. */
export const BUSY_ENERGY = 0.7
/** At or above this the beat is steady enough to draw on. */
export const DANCEABLE = 0.6

/**
 * The visual a song gets when nobody has chosen one.
 *
 * A song not analysed yet gets Aurora: it needs nothing but the cover's
 * colour. Energy decides first, because a loud song with a steady beat is
 * still loud; the beat decides between the two in the middle.
 */
export function autoVisual(features: SongFeatures | null | undefined): VisualKind {
  const energy = features?.energy
  if (energy == null || energy < CALM_ENERGY) return 'aurora'
  if (energy >= BUSY_ENERGY) return 'spectrum'
  if ((features?.danceability ?? 0) >= DANCEABLE) return 'pulse'
  return 'drift'
}

export function isVisualKind(value: unknown): value is VisualKind {
  return typeof value === 'string' && (VISUAL_KINDS as readonly string[]).includes(value)
}

/** The choices kept on this device, by song id. Anything unreadable is no choice. */
export type VisualChoices = Readonly<Record<string, VisualKind>>

export function parseVisualChoices(raw: string | null): VisualChoices {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const choices: Record<string, VisualKind> = {}
    for (const [id, kind] of Object.entries(parsed)) if (isVisualKind(kind)) choices[id] = kind
    return choices
  } catch {
    return {}
  }
}

/** `null` goes back to the automatic pick. */
export function withVisualChoice(
  choices: VisualChoices,
  songId: number,
  kind: VisualKind | null,
): VisualChoices {
  const next: Record<string, VisualKind> = { ...choices }
  if (kind === null) delete next[String(songId)]
  else next[String(songId)] = kind
  return next
}

/** "No lyrics · 140 BPM · A minor", leaving out what is not known. */
export function visualCaption(features: SongFeatures | null | undefined): string {
  const parts = ['No lyrics']
  if (features?.bpm != null) parts.push(`${Math.round(features.bpm)} BPM`)
  if (features?.key) parts.push(features.key)
  return parts.join(' · ')
}

/**
 * What the visual is following, said quietly under the caption: the sound
 * itself where the browser can listen, the song's stored motion where it
 * cannot, and only its tempo when neither is there.
 */
export function motionCaption(source: 'live' | 'curve' | 'beat'): string {
  return source === 'live'
    ? 'Following the sound'
    : source === 'curve'
      ? 'Following the song'
      : 'Following the tempo'
}

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
  const base = ((hue % 360) + 360) % 360
  if (mood === null) return base
  // The shorter way round the wheel, so 350° warms through 0°, not back through 180°.
  const toward = ((mood - base + 540) % 360) - 180
  const pulled = base + Math.max(-KEY_PULL, Math.min(KEY_PULL, toward))
  return ((pulled % 360) + 360) % 360
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
}

export function visualColors(
  hue: number,
  camelot: string | null | undefined,
  palette?: readonly CoverSwatch[] | null,
): VisualColors {
  if (palette && palette.length > 0) return paletteColors(palette, hue)
  const h = keyedHue(hue, camelot)
  const at = (lightness: number, chroma: number, turn: number): Rgb =>
    hexRgb(oklchToHex(lightness, chroma, (h + turn + 360) % 360))
  return {
    inks: [at(0.78, 0.14, 0), at(0.72, 0.15, 32), at(0.84, 0.1, -28)],
    ground: [at(0.22, 0.05, 0), at(0.12, 0.03, 0)],
  }
}

/** Hues closer than this read as the same colour, so a palette's inks keep them apart. */
const INK_HUE_SPREAD = 35

const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)
const wrapHue = (h: number): number => ((h % 360) + 360) % 360
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))

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
 * on the dark. The lead colour is the Pulse's dot (`inks[2]`, the lightest);
 * the next two are the halo and rings (`inks[0]`, `inks[1]`). The ground is the
 * cover's deepest colour, dark and quiet, steered out of the olive band. A
 * cover with fewer than three colours borrows its neighbours on the wheel.
 * The key does not pull the hues here: the cover's own colours already say
 * what the song looks like.
 */
export function paletteColors(palette: readonly CoverSwatch[], leadHue: number): VisualColors {
  const vivid = palette
    .filter(swatch => swatch.c >= 0.02)
    .map(swatch => ({ swatch, score: swatch.share * (swatch.c + 0.02) * (0.4 + Math.min(swatch.l, 0.8)) }))
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
  const at = (lightness: number, chroma: number, h: number): Rgb => hexRgb(oklchToHex(lightness, chroma, h))

  const byDepth = [...palette].sort((a, b) => a.l - b.l)
  const deep = byDepth.find(swatch => swatch.c >= 0.015) ?? byDepth[0]
  const gh = groundHue(deep ? deep.h : 260)
  const gc = clamp((deep ? deep.c : 0.02) * 0.8, 0.015, 0.045)
  return {
    inks: [at(0.74, chromaFor(second), second), at(0.7, chromaFor(third), third), at(0.86, chromaFor(lead) * 0.8, lead)],
    ground: [at(0.19, gc, gh), at(0.1, gc * 0.6, gh)],
  }
}

export const rgbCss = ([r, g, b]: Rgb, alpha = 1): string =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`

function hexRgb(hex: string): Rgb {
  return [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb
}

/* ------------------------------------------------------------------ motion */

/** What a visual moves with, with a middling stand-in for anything not analysed. */
export interface VisualFeel {
  readonly bpm: number
  readonly energy: number
  readonly danceability: number
  /** 0–1 from the song's loudness: brightness breathes around it. */
  readonly loudness: number
}

export function visualFeel(features: SongFeatures | null | undefined): VisualFeel {
  const bpm = features?.bpm
  return {
    // A tempo detector's half- and double-time answers stay in a drawable range.
    bpm: bpm == null ? 96 : Math.max(50, Math.min(200, bpm)),
    energy: features?.energy ?? 0.45,
    danceability: features?.danceability ?? 0.5,
    loudness: loudnessLevel(features?.loudnessLufs ?? null),
  }
}

/** Integrated loudness from about −30 LUFS (quiet) to −6 (a loud master), as 0–1. */
export function loudnessLevel(lufs: number | null): number {
  if (lufs == null || !Number.isFinite(lufs)) return 0.5
  return Math.max(0, Math.min(1, (lufs + 30) / 24))
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

/** Drift's turn, in radians a second: a faster song turns faster. */
export function driftSpeed(bpm: number): number {
  return 0.35 * (bpm / 120)
}

/** Drift's outer reach, as a share of the shorter side: more energy draws the specks in. */
export function driftReach(energy: number): number {
  return 0.46 - 0.2 * Math.max(0, Math.min(1, energy))
}

/**
 * Levels for Spectrum where the sound itself cannot be heard: low to high,
 * 0–1, built from the song's tempo and energy. The bass lands on the beat,
 * the top end on the off-beats, and the rest wanders, so the bars read as
 * music rather than as a sine wave.
 */
export function synthLevels(count: number, seconds: number, bpm: number, energy: number): number[] {
  const beats = (seconds * bpm) / 60
  const kick = Math.exp(-(((beats % 1) + 1) % 1) * 7)
  const hat = Math.exp(-((((beats * 2) % 1) + 1) % 1) * 12)
  const levels: number[] = []
  for (let i = 0; i < count; i++) {
    const x = count > 1 ? i / (count - 1) : 0
    const tilt = Math.pow(1 - x, 1.3) * 0.8 + 0.06
    let level = tilt * (0.3 + 0.7 * valueNoise(i * 0.33, seconds * (1 + 2 * energy))) * (0.3 + 0.7 * energy)
    level += kick * (x < 0.14 ? 0.6 : x < 0.3 ? 0.22 : 0.05) * (0.3 + energy)
    level += hat * (x > 0.6 ? 0.28 : 0) * energy
    levels.push(Math.max(0, Math.min(1, level)))
  }
  return levels
}

/** The moment a still frame shows, for Reduce Motion: a little after a beat, so rings are out. */
export const STILL_SECONDS = 2.2

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Smooth value noise, 0–1: the stand-in spectrum's wander, and the curve's per-band wobble. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
