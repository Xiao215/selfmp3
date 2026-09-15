import type { FrequencyAnalyser } from '@selfmp3/client'
import { beatKick, beatPhase, synthLevels, valueNoise, type VisualFeel } from './visuals.model'

/**
 * What the music is doing right now, for a visual to draw every frame.
 *
 * There are three answers, used in this order. Where the browser can listen
 * (`ports/liveAudio`: Chrome, Edge, Firefox, the Mac app) the engine's
 * analyser is the sound itself. Everywhere else — the phone, Safari, a touch
 * browser, a cloud library, offline — the song's motion curve, worked out by
 * the server when it analysed the song, is played back against the playhead:
 * the song's own loud and quiet parts and its hits, a frame every 50 ms. Only
 * a song with neither (not analysed yet, never fetched for offline) falls back
 * to a stand-in drawn from its tempo and energy, which is the one place a beat
 * keeps time on its own.
 *
 * All three sit behind one small interface, so the four styles draw the same
 * way whichever is behind them, and the styles never learn which it is. Pure
 * apart from the analyser it is handed: vitest runs every sampler.
 */

/** What the visual reads every frame: 0–1 overall level, 0–1 onset, and 0–1 bands low→high. */
export interface MotionFrame {
  level: number
  onset: number
  bands: readonly number[]
}

export interface MotionSampler {
  /** `seconds` is the playhead; `into` has `bands.length` slots to fill. */
  sample(seconds: number, into: Float32Array): { level: number; onset: number }
  /** 'live' reads the analyser, 'curve' the stored motion, 'beat' the tempo/energy fallback. */
  readonly source: 'live' | 'curve' | 'beat'
}

export type MotionSourceKind = MotionSampler['source']

/**
 * The stored curve, decoded: the same shape as `MotionCurve` from
 * `@selfmp3/client`, spelled out here so this file stands on its own until the
 * client's is in. A structural type, so the client's value fits it unchanged.
 */
export interface MotionCurveLike {
  /** Frames per second. */
  readonly rate: number
  /** Seconds the frames cover. */
  readonly duration: number
  /** One byte a frame: -60 dBFS at 0 to 0 dBFS at 255. */
  readonly loudness: Uint8Array
  /** One byte a frame: onset strength, the song's 98th percentile at 255. */
  readonly onset: Uint8Array
}

export type CurveSample = (curve: MotionCurveLike, seconds: number) => { level: number; onset: number }

/**
 * Level 0–1 and onset 0–1 at a time, linearly interpolated between frames; 0
 * before the start and past the end. Behaves exactly as the client's
 * `sampleMotion`, which replaces it once that is in.
 */
export const sampleCurve: CurveSample = (curve, seconds) => {
  const frames = Math.min(curve.loudness.length, curve.onset.length)
  if (!(seconds >= 0) || seconds >= curve.duration || frames === 0) return { level: 0, onset: 0 }
  const at = seconds * curve.rate
  const i = Math.floor(at)
  if (i >= frames) return { level: 0, onset: 0 }
  const j = Math.min(frames - 1, i + 1)
  const f = at - i
  const lerp = (bytes: Uint8Array): number => ((bytes[i] ?? 0) + ((bytes[j] ?? 0) - (bytes[i] ?? 0)) * f) / 255
  return { level: lerp(curve.loudness), onset: lerp(curve.onset) }
}

/* ------------------------------------------------------------------- live */

/** How a live band is shaped from the analyser's byte: the curve Spectrum has always drawn with. */
export function shapeBin(byte: number): number {
  // A modern master sits near the top of the byte range, and a gentle curve
  // draws every bar at full length; a steep one leaves room for quiet.
  return Math.min(1, Math.pow(byte / 255, 2.6) * 1.25)
}

/** The share of the analyser's bins with any music in them: the top quarter is almost always empty. */
export const LIVE_USABLE = 0.75
/** The share of the usable bins that carry the hits: the bass, the kick and the snare's body. */
export const LIVE_LOW = 0.14
/** The shaped mean a loud chorus reaches, which maps to a level of 1. */
export const LIVE_LOUD = 0.34
/** Seconds the running average of the low bins looks back: an onset is a rise above it. */
export const FLUX_MEMORY = 0.1
/** Seconds the onset normaliser's peak takes to fall to a third. */
export const FLUX_PEAK_DECAY = 3
/**
 * The smallest rise that can count as a whole onset, in the byte scale's
 * units (0–1 across the analyser's 70 dB): below it a quiet passage's small
 * movements stay small instead of being normalised up into hits.
 */
export const FLUX_FLOOR = 0.045

const clock = (): number => (globalThis.performance?.now() ?? Date.now()) / 1000

/**
 * The sound itself, from the engine's analyser.
 *
 * Bands are the usable bins averaged into as many bands as asked for, on
 * Spectrum's curve. Level is the root mean square of all of them, scaled so a
 * loud chorus reaches 1 — a quiet verse is genuinely lower, not normalised
 * up. Onset is spectral flux on the low bins: how far each has risen above
 * its own short running average, summed, and divided by a peak that falls
 * away slowly, so a hit reads near 1 in a loud song and in a quiet one alike,
 * but a floor keeps the hush between hits from becoming hits of its own.
 */
export function liveSampler(analyser: FrequencyAnalyser, now: () => number = clock): MotionSampler {
  const bins = new Uint8Array(analyser.frequencyBinCount)
  const usable = Math.max(1, Math.floor(bins.length * LIVE_USABLE))
  const low = Math.max(2, Math.round(usable * LIVE_LOW))
  const average = new Float32Array(low)
  let primed = false
  let peak = FLUX_FLOOR
  let last: number | null = null

  return {
    source: 'live',
    sample(_seconds, into) {
      const at = now()
      const dt = last === null ? 1 / 60 : Math.max(0, Math.min(0.1, at - last))
      last = at
      analyser.getByteFrequencyData(bins)

      let squares = 0
      for (let i = 0; i < usable; i++) {
        const shaped = shapeBin(bins[i] ?? 0)
        squares += shaped * shaped
      }
      const level = Math.min(1, Math.sqrt(squares / usable) / LIVE_LOUD)

      const count = into.length
      for (let band = 0; band < count; band++) {
        const start = Math.floor((band / count) * usable)
        const end = Math.max(start + 1, Math.floor(((band + 1) / count) * usable))
        let sum = 0
        for (let i = start; i < end; i++) sum += bins[i] ?? 0
        into[band] = shapeBin(sum / (end - start))
      }

      let flux = 0
      const follow = 1 - Math.exp(-dt / FLUX_MEMORY)
      for (let i = 0; i < low; i++) {
        const value = (bins[i] ?? 0) / 255
        if (primed) flux += Math.max(0, value - (average[i] ?? 0))
        average[i] = primed ? (average[i] ?? 0) + (value - (average[i] ?? 0)) * follow : value
      }
      primed = true
      flux /= low
      peak = Math.max(flux, FLUX_FLOOR, peak * Math.exp(-dt / FLUX_PEAK_DECAY))
      return { level, onset: Math.min(1, flux / peak) }
    },
  }
}

/* ------------------------------------------------------------------ curve */

/** The loudness a quiet passage sits at, in dBFS of short-term RMS: level 0 from here down. */
export const CURVE_QUIET_DB = -45
/** The loudness a loud master's chorus reaches: level 1 from here up. */
export const CURVE_LOUD_DB = -9

/**
 * The curve's loudness byte as a visual level. The byte covers -60 to 0 dBFS,
 * but music lives between about -45 and -9, so a straight read would squeeze
 * a quiet intro and a loud chorus together near the middle. A gentle bend
 * keeps the quiet end quiet.
 */
export function curveLevel(loudness: number): number {
  const db = loudness * 60 - 60
  const x = (db - CURVE_QUIET_DB) / (CURVE_LOUD_DB - CURVE_QUIET_DB)
  return Math.pow(Math.max(0, Math.min(1, x)), 1.4)
}

/** A seed from the song, so two songs' bars do not wobble identically. */
export function songSeed(songId: number): number {
  const s = Math.sin(songId * 12.9898 + 78.233) * 43758.5453
  return (s - Math.floor(s)) * 100
}

/**
 * Bands for a song whose sound cannot be heard, shaped from its curve: overall
 * height from the level, tilted so the bass stands taller, as music does; the
 * low bands jump on a hit and the top end shimmers with it; and a slow wobble
 * per band, seeded by the song, so it reads as a spectrum rather than a bar
 * chart of one number.
 */
export function curveBands(
  into: Float32Array,
  level: number,
  onset: number,
  seconds: number,
  seed: number,
): void {
  const count = into.length
  const presence = 0.35 + 0.65 * level
  for (let i = 0; i < count; i++) {
    const x = count > 1 ? i / (count - 1) : 0
    const tilt = 0.28 + 0.72 * Math.pow(1 - x, 1.2)
    const wobble = valueNoise(i * 0.37 + seed, seconds * 1.3)
    let value = level * tilt * (0.5 + 0.5 * wobble)
    if (x < 0.3) value += onset * (1 - x / 0.3) * 0.55 * presence
    if (x > 0.55) value += onset * 0.3 * valueNoise(i * 1.7 + seed * 3, seconds * 9) * presence
    into[i] = Math.max(0, Math.min(1, value))
  }
}

/**
 * The song's stored curve, played back against the playhead.
 *
 * The onset is the strongest frame passed since the last draw, not just the
 * value where this draw landed: a hit is a single 50 ms frame, and a phone
 * drawing at 30 frames a second could step straight over it. A seek or a
 * pause (the playhead jumping or standing) reads only where it is.
 */
export function curveSampler(
  curve: MotionCurveLike,
  songId: number,
  sample: CurveSample = sampleCurve,
): MotionSampler {
  const seed = songSeed(songId)
  const frames = Math.min(curve.loudness.length, curve.onset.length)
  let previous = -1
  return {
    source: 'curve',
    sample(seconds, into) {
      const here = sample(curve, seconds)
      let onset = here.onset
      const gap = seconds - previous
      if (previous >= 0 && gap > 0 && gap < 0.25 && seconds < curve.duration) {
        const first = Math.ceil(previous * curve.rate)
        const lastFrame = Math.min(frames - 1, Math.floor(seconds * curve.rate))
        for (let i = Math.max(0, first); i <= lastFrame; i++) onset = Math.max(onset, (curve.onset[i] ?? 0) / 255)
      }
      previous = seconds
      const level = curveLevel(here.level)
      curveBands(into, level, onset, seconds, seed)
      return { level, onset }
    },
  }
}

/* ------------------------------------------------------------------- beat */

/**
 * The stand-in for a song with no curve and no sound to hear: the tempo and
 * energy synthesis the visuals always had, behind the same interface. The
 * onset is the beat's kick, so Pulse still rings on the beat for a song not
 * analysed yet — the only place anything keeps time by itself.
 */
export function beatSampler(feel: VisualFeel): MotionSampler {
  return {
    source: 'beat',
    sample(seconds, into) {
      const kick = beatKick(beatPhase(seconds, feel.bpm))
      const levels = synthLevels(into.length, seconds, feel.bpm, feel.energy)
      for (let i = 0; i < into.length; i++) into[i] = levels[i] ?? 0
      const level = Math.min(1, 0.2 + 0.45 * feel.loudness + 0.2 * feel.energy * kick)
      return { level, onset: kick * (0.55 + 0.45 * feel.energy) }
    },
  }
}

/** Live where it can listen, the stored curve where there is one, the beat otherwise. */
export function chooseSampler({
  canHear,
  analyser,
  curve,
  feel,
  songId,
}: {
  canHear: boolean
  analyser: FrequencyAnalyser | null
  curve: MotionCurveLike | null
  feel: VisualFeel
  songId: number
}): MotionSampler {
  if (canHear && analyser) return liveSampler(analyser)
  if (curve && Math.min(curve.loudness.length, curve.onset.length) > 0) return curveSampler(curve, songId)
  return beatSampler(feel)
}
