import type { FrequencyAnalyser } from '@selfmp3/client'
import { beatKick, beatPhase, type VisualFeel } from './visuals.model'

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
 * All three sit behind one small interface, so Horizon and Ripples draw the
 * same way whichever is behind them, and never learn which it is. Live
 * and curve agree on what "loud" means: both become a level through the same
 * decibel scale (`levelFromDb`). Pure apart from the analyser it is handed:
 * vitest runs every sampler.
 */

export interface MotionSampler {
  /** `seconds` is the playhead. Level and onset are both 0–1. */
  sample(seconds: number): { level: number; onset: number }
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

type CurveSample = (curve: MotionCurveLike, seconds: number) => { level: number; onset: number }

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
  const lerp = (bytes: Uint8Array): number =>
    ((bytes[i] ?? 0) + ((bytes[j] ?? 0) - (bytes[i] ?? 0)) * f) / 255
  return { level: lerp(curve.loudness), onset: lerp(curve.onset) }
}

/* ------------------------------------------------------------------ level */

/** The loudness a quiet passage sits at, in dBFS of short-term RMS: level 0 from here down. */
const QUIET_DB = -40
/** The loudness a loud master's chorus reaches: level 1 from here up. */
const LOUD_DB = -9

/**
 * A short-term loudness in dBFS as a visual level. Music lives between about
 * -40 and -9 dBFS; a bend keeps the quiet end quiet, so a verse at -30 draws
 * small and a chorus at -10 draws big.
 */
function levelFromDb(db: number): number {
  if (!Number.isFinite(db)) return 0
  const x = (db - QUIET_DB) / (LOUD_DB - QUIET_DB)
  return Math.pow(Math.max(0, Math.min(1, x)), 1.6)
}

/** The curve's loudness byte (0–1 across -60 to 0 dBFS) as a visual level. */
export function curveLevel(loudness: number): number {
  return levelFromDb(loudness * 60 - 60)
}

/* ------------------------------------------------------------------- live */

/** How a live bin is shaped from the analyser's reading (0–1 across its range), for the level. */
function shapeBin(value: number): number {
  // A modern master sits near the top of the analyser's range, and a gentle
  // curve reads every bin as full; a steep one leaves room for quiet. The
  // loudness reference below was measured on this curve, so it stays.
  return Math.min(1, Math.pow(Math.max(0, Math.min(1, value)), 2.6) * 1.25)
}

/** The share of the analyser's bins with any music in them: the top quarter is almost always empty. */
const LIVE_USABLE = 0.75
/** The share of the usable bins that carry the hits: the bass, the kick and the snare's body. */
const LIVE_LOW = 0.14
/**
 * The shaped root mean square of the bins, and the loudness it was measured at
 * (Chromium, songs from the dev library, against ffmpeg's RMS): it moves about
 * 17 dB per factor of e, so a level comes from it through the curve's scale.
 */
const LIVE_REF_RMS = 0.376
const LIVE_REF_DB = -10
const LIVE_DB_PER_E = 17.3
/** Seconds the running average of the low bins looks back: an onset is a rise above it. */
const FLUX_MEMORY = 0.1
/** Seconds the onset normaliser's peak takes to fall to a third. */
const FLUX_PEAK_DECAY = 1.5
/**
 * The smallest rise that can count as a whole onset, in the analyser's range
 * (1 across its 70 dB): below it a quiet passage's small movements stay small
 * instead of being normalised up into hits.
 */
const FLUX_FLOOR = 0.03
/** A playhead jump bigger than this, in seconds, is a seek rather than a slow frame. */
const SEEK_JUMP = 0.75
/** Seconds after a seek before a rise can count as a hit: the analyser's own smoothing settling. */
const SEEK_SETTLE = 0.3

/** The live sampler's raw numbers from its last frame, for calibrating it against real songs. */
interface LiveTrace {
  rms: number
  flux: number
}

/** An analyser that can also answer in decibels, unclipped: a browser's `AnalyserNode`. */
interface DecibelAnalyser extends FrequencyAnalyser {
  getFloatFrequencyData(into: Float32Array): void
  readonly minDecibels: number
  readonly maxDecibels: number
}

function hasDecibels(analyser: FrequencyAnalyser): analyser is DecibelAnalyser {
  const candidate = analyser as Partial<DecibelAnalyser>
  return (
    typeof candidate.getFloatFrequencyData === 'function' &&
    typeof candidate.minDecibels === 'number' &&
    typeof candidate.maxDecibels === 'number'
  )
}

const clock = (): number => (globalThis.performance?.now() ?? Date.now()) / 1000

/** The live level from the shaped root mean square: an estimate of the loudness, on the curve's scale. */
function liveLevel(rms: number): number {
  if (!(rms > 0)) return 0
  return levelFromDb(LIVE_REF_DB + LIVE_DB_PER_E * Math.log(rms / LIVE_REF_RMS))
}

/**
 * The sound itself, from the engine's analyser.
 *
 * Each bin is read as a share of the analyser's decibel range. Level is the
 * shaped usable bins' root mean square, turned into an estimate of the
 * loudness, so a quiet verse is genuinely lower rather than normalised up. Onset is
 * spectral flux on the low bins: how far each has risen above its own short
 * running average, summed, over a peak that falls away over a second or two,
 * so a hit reads near 1 in a loud song and a quiet one alike, with a floor so
 * the hush between hits does not become hits of its own.
 *
 * The flux reads the analyser in decibels where it can. Its bytes stop at the
 * top of its range, and a loud chorus's bass sits there: every kick would be
 * 255 rising to 255, and the loudest part of a song would have no hits at all.
 */
export function liveSampler(
  analyser: FrequencyAnalyser,
  now: () => number = clock,
): MotionSampler & { readonly trace: LiveTrace } {
  const count = analyser.frequencyBinCount
  const decibels = hasDecibels(analyser) ? analyser : null
  const bytes = decibels ? null : new Uint8Array(count)
  const floats = decibels ? new Float32Array(count) : null
  const values = new Float32Array(count)
  const usable = Math.max(1, Math.floor(count * LIVE_USABLE))
  const low = Math.max(2, Math.round(usable * LIVE_LOW))
  const average = new Float32Array(low)
  const trace: LiveTrace = { rms: 0, flux: 0 }
  let primed = false
  let settling = 0
  let peak = FLUX_FLOOR
  let last: number | null = null
  let lastSeconds: number | null = null

  /** Fills `values` with each bin as a share of the analyser's range: 0 at its floor, 1 at its top, more above it. */
  const read = (): void => {
    if (decibels && floats) {
      decibels.getFloatFrequencyData(floats)
      const floor = decibels.minDecibels
      const span = decibels.maxDecibels - floor || 1
      for (let i = 0; i < count; i++) {
        const db = floats[i] ?? -Infinity
        values[i] = Number.isFinite(db) ? Math.max(0, (db - floor) / span) : 0
      }
    } else if (bytes) {
      analyser.getByteFrequencyData(bytes)
      for (let i = 0; i < count; i++) values[i] = (bytes[i] ?? 0) / 255
    }
  }

  return {
    source: 'live',
    trace,
    sample(seconds) {
      const at = now()
      const dt = last === null ? 1 / 60 : Math.max(0, Math.min(0.1, at - last))
      last = at
      // A seek, or the next song, jumps the playhead and the whole spectrum
      // with it. That is not a hit: forget the running average and the peak,
      // and let the analyser's own smoothing catch up before listening again.
      if (lastSeconds !== null && Math.abs(seconds - lastSeconds) > SEEK_JUMP) {
        primed = false
        settling = SEEK_SETTLE
        peak = FLUX_FLOOR
      }
      lastSeconds = seconds
      read()

      let squares = 0
      for (let i = 0; i < usable; i++) {
        const shaped = shapeBin(values[i] ?? 0)
        squares += shaped * shaped
      }
      trace.rms = Math.sqrt(squares / usable)
      const level = liveLevel(trace.rms)

      let flux = 0
      const follow = 1 - Math.exp(-dt / FLUX_MEMORY)
      for (let i = 0; i < low; i++) {
        const value = values[i] ?? 0
        if (primed) flux += Math.max(0, value - (average[i] ?? 0))
        average[i] = primed ? (average[i] ?? 0) + (value - (average[i] ?? 0)) * follow : value
      }
      flux /= low
      if (settling > 0) {
        settling -= dt
        primed = false
        flux = 0
      } else {
        primed = true
      }
      trace.flux = flux
      peak = Math.max(flux, FLUX_FLOOR, peak * Math.exp(-dt / FLUX_PEAK_DECAY))
      return { level, onset: Math.min(1, flux / peak) }
    },
  }
}

/* ------------------------------------------------------------------ curve */

/** How far either side a frame is compared with, for its hit (≈ ±250 ms at 20 fps). */
const HIT_CONTEXT_SECONDS = 0.25
/** A hit is the highest frame within this many seconds either side (≈ ±100 ms). */
const HIT_PEAK_SECONDS = 0.1
/** The smallest rise above its surroundings that can be a hit, as a share of full scale. */
const HIT_MIN_RISE = 0.04
/** Onset below this is the floor of a quiet passage, never a hit. */
const HIT_FLOOR = 0.15

/**
 * Where the curve's hits are, and how hard: one value a frame, 0 between hits.
 *
 * The stored onset is normalised to the song's own 98th percentile, so a dense
 * loud chorus sits near the top nearly every frame. Read as it is, that is one
 * long hit that never lets go — Ripples would stop ringing exactly where the
 * song is busiest. So a hit is a frame that stands out from its surroundings:
 * the highest within ±100 ms, and above the ±250 ms average by more than a
 * whisker, scaled by how far it rises towards the local top and weighted by
 * its own strength so a quiet passage's hits stay softer than a chorus's. That
 * is the same question the live sampler asks of the analyser — a rise above a
 * running average — asked of the stored frames, once, when the curve arrives.
 */
export function curveHits(onset: Uint8Array, rate: number): Float32Array {
  const count = onset.length
  const hits = new Float32Array(count)
  const context = Math.max(1, Math.round(HIT_CONTEXT_SECONDS * rate))
  const peak = Math.max(1, Math.round(HIT_PEAK_SECONDS * rate))
  for (let i = 0; i < count; i++) {
    const v = (onset[i] ?? 0) / 255
    if (v < HIT_FLOOR) continue
    let isPeak = true
    for (let j = Math.max(0, i - peak); j <= Math.min(count - 1, i + peak); j++) {
      const w = (onset[j] ?? 0) / 255
      // Ties go to the first of a flat top, so a plateau is one hit, not several.
      if (w > v || (w === v && j < i)) {
        isPeak = false
        break
      }
    }
    if (!isPeak) continue
    let sum = 0
    let top = 0
    let n = 0
    for (let j = Math.max(0, i - context); j <= Math.min(count - 1, i + context); j++) {
      const w = (onset[j] ?? 0) / 255
      sum += w
      top = Math.max(top, w)
      n++
    }
    const mean = sum / n
    const rise = v - mean
    if (rise < HIT_MIN_RISE) continue
    hits[i] = Math.min(1, rise / Math.max(HIT_MIN_RISE, top - mean)) * (0.5 + 0.5 * v)
  }
  return hits
}

/**
 * The song's stored curve, played back against the playhead.
 *
 * The onset is the strongest hit passed since the last draw, not just the
 * frame where this draw landed: a hit is a single 50 ms frame, and a phone
 * drawing at 30 frames a second could step straight over it. A seek or a
 * pause (the playhead jumping or standing) reads only where it is.
 */
export function curveSampler(
  curve: MotionCurveLike,
  sample: CurveSample = sampleCurve,
): MotionSampler {
  const frames = Math.min(curve.loudness.length, curve.onset.length)
  const hits = curveHits(curve.onset.subarray(0, frames), curve.rate)
  const hitAt = (seconds: number): number => {
    const i = Math.round(seconds * curve.rate)
    return i >= 0 && i < frames ? (hits[i] ?? 0) : 0
  }
  let previous = -1
  return {
    source: 'curve',
    sample(seconds) {
      const here = sample(curve, seconds)
      let onset = seconds < curve.duration ? hitAt(seconds) : 0
      const gap = seconds - previous
      if (previous >= 0 && gap > 0 && gap < 0.25 && seconds < curve.duration) {
        const first = Math.ceil(previous * curve.rate)
        const lastFrame = Math.min(frames - 1, Math.floor(seconds * curve.rate))
        for (let i = Math.max(0, first); i <= lastFrame; i++) onset = Math.max(onset, hits[i] ?? 0)
      }
      previous = seconds
      return { level: curveLevel(here.level), onset }
    },
  }
}

/* ------------------------------------------------------------------- beat */

/**
 * The stand-in for a song with no curve and no sound to hear: the tempo and
 * energy synthesis the visuals always had, behind the same interface. The
 * onset is the beat's kick, so Ripples still rings on the beat for a song not
 * analysed yet — the only place anything keeps time by itself.
 */
export function beatSampler(feel: VisualFeel): MotionSampler {
  return {
    source: 'beat',
    sample(seconds) {
      const kick = beatKick(beatPhase(seconds, feel.bpm))
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
}: {
  canHear: boolean
  analyser: FrequencyAnalyser | null
  curve: MotionCurveLike | null
  feel: VisualFeel
}): MotionSampler {
  if (canHear && analyser) return liveSampler(analyser)
  if (curve && Math.min(curve.loudness.length, curve.onset.length) > 0) return curveSampler(curve)
  return beatSampler(feel)
}
