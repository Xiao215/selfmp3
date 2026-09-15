import type { MotionSampler, MotionSourceKind } from './motionSource'
import { driftSpeed, STILL_SECONDS, synthLevels, type VisualFeel } from './visuals.model'

/**
 * How a visual moves, frame by frame, from what its sampler hears.
 *
 * The browser's canvas and the phone's views both step one of these each
 * frame and then only draw what it holds, so Aurora, Pulse, Spectrum and
 * Drift move the same way on every screen. What each style takes from it:
 *
 * - Aurora: `glow` (the level, smoothed over about 300 ms) sets how tall and
 *   bright the bands are and how fast they sway; `flash` brightens them on a
 *   strong hit.
 * - Pulse: a ring leaves the centre on each onset peak — past a threshold,
 *   no sooner than a refractory period after the last one — with its
 *   strength from the onset; the dot follows `glow` and kicks on the hit.
 * - Spectrum: `bands`, quick to rise and slow to fall, as meters do.
 * - Drift: `spin` turns faster the louder it is; `burst` pushes the specks
 *   out on a hit and eases them back.
 *
 * Silence is nearly still: no level, no rings, no sway. A paused song steps
 * as silence, so it settles rather than freezing mid-hit. Pure: vitest runs it.
 */

export interface PulseRing {
  /** Counts up from the first ring, so a phone can keep each ring in the same view. */
  readonly id: number
  /** Seconds since it left the centre. */
  age: number
  /** 0–1, from the onset that sent it and how loud the song was then. */
  readonly strength: number
}

export interface MotionState {
  source: MotionSourceKind
  /** The level as sampled this frame. */
  level: number
  /** The level smoothed over about 300 ms: what most of a style's size and brightness follow. */
  glow: number
  onset: number
  /** 0–1, a brightening after a strong hit, falling away in about a quarter second. */
  flash: number
  /** 0–1, the centre dot's kick on each ring sent, gone in about a tenth of a second. */
  kick: number
  /** 0–1, Drift's outward push on a hit, eased back. */
  burst: number
  /** Drift's turn so far, radians. */
  spin: number
  /** Aurora's sway so far: advances faster the louder it is. */
  sway: number
  /** Spectrum's bars, low to high, 0–1. */
  bands: Float32Array
  /** The rings on screen, oldest first. */
  rings: PulseRing[]
  /** Whether a ring left on this frame. */
  fired: boolean
  // What the onset trigger remembers.
  clock: number
  lastFire: number
  armed: boolean
  peakSinceFire: number
  nextRing: number
  scratch: Float32Array
}

export function createMotionState(bandCount: number): MotionState {
  return {
    source: 'beat',
    level: 0,
    glow: 0,
    onset: 0,
    flash: 0,
    kick: 0,
    burst: 0,
    spin: 0,
    sway: 0,
    bands: new Float32Array(bandCount),
    rings: [],
    fired: false,
    clock: 0,
    lastFire: -Infinity,
    armed: true,
    peakSinceFire: 0,
    nextRing: 0,
    scratch: new Float32Array(bandCount),
  }
}

/** Changes how many bands the state keeps (Spectrum's bar count follows its width), keeping the rest. */
export function resizeBands(state: MotionState, bandCount: number): void {
  if (state.bands.length === bandCount) return
  state.bands = new Float32Array(bandCount)
  state.scratch = new Float32Array(bandCount)
}

/** An onset at or above this can send a ring. */
export const ONSET_THRESHOLD = 0.45
/** After a ring, the onset has to fall to this share of its peak before another can go. */
export const REARM_SHARE = 0.6
/** Below this level nothing is a hit: the hiss of a fade-out does not ring. */
export const QUIET_LEVEL = 0.04
/** At most this many rings at once; the phone keeps one view for each. */
export const MAX_RINGS = 6
/** The refractory period with no tempo to go by, in seconds. */
export const DEFAULT_REFRACTORY = 0.18

export interface MotionTuning {
  /** Seconds after a ring before another can leave. */
  readonly refractory: number
  /** Seconds a ring takes to reach the edge and fade. */
  readonly ringLife: number
  readonly feel: VisualFeel
}

/**
 * The song's tempo, where it is known, sets how close together rings may
 * come — about six tenths of a beat, so a busy hi-hat does not fill the
 * screen but every beat still can ring — and how long each lasts.
 */
export function motionTuning(feel: VisualFeel, bpmKnown: boolean): MotionTuning {
  const beat = 60 / feel.bpm
  return {
    refractory: bpmKnown ? 0.6 * beat : DEFAULT_REFRACTORY,
    ringLife: Math.max(1.4, Math.min(2.6, 4 * beat)),
    feel,
  }
}

const ease = (dt: number, seconds: number): number => 1 - Math.exp(-dt / seconds)

/**
 * One frame. `playing` false steps as silence (the sampler is not asked);
 * `dt` 0 changes nothing at all, for a frame drawn twice.
 */
export function stepMotion(
  state: MotionState,
  sampler: MotionSampler,
  seconds: number,
  dt: number,
  playing: boolean,
  tuning: MotionTuning,
): void {
  state.fired = false
  state.source = sampler.source
  if (!(dt > 0)) return
  let level = 0
  let onset = 0
  if (playing) {
    const heard = sampler.sample(seconds, state.scratch)
    level = clamp01(heard.level)
    onset = clamp01(heard.onset)
  } else {
    state.scratch.fill(0)
  }
  state.level = level
  state.onset = onset
  state.clock += dt

  state.glow += (level - state.glow) * ease(dt, 0.3)

  const rise = ease(dt, 0.035)
  const fall = ease(dt, 0.25)
  for (let i = 0; i < state.bands.length; i++) {
    const goal = state.scratch[i] ?? 0
    const now = state.bands[i] ?? 0
    state.bands[i] = now + (goal - now) * (goal > now ? rise : fall)
  }

  state.kick *= Math.exp(-dt / 0.12)
  state.flash *= Math.exp(-dt / 0.25)
  state.burst *= Math.exp(-dt / 0.35)

  if (
    state.armed &&
    onset >= ONSET_THRESHOLD &&
    level >= QUIET_LEVEL &&
    state.clock - state.lastFire >= tuning.refractory
  ) {
    const presence = 0.35 + 0.65 * level
    const strength = onset * presence
    state.rings.push({ id: state.nextRing++, age: 0, strength })
    state.fired = true
    state.armed = false
    state.peakSinceFire = onset
    state.lastFire = state.clock
    state.kick = Math.max(state.kick, strength)
    state.burst = Math.max(state.burst, strength)
    // Only a strong hit flashes: the start of a chorus, not every hi-hat.
    state.flash = Math.max(state.flash, clamp01((onset - 0.65) / 0.35) * presence)
  } else if (!state.armed) {
    state.peakSinceFire = Math.max(state.peakSinceFire, onset)
    if (onset < state.peakSinceFire * REARM_SHARE || onset < ONSET_THRESHOLD * REARM_SHARE) state.armed = true
  }

  for (const ring of state.rings) ring.age += dt
  state.rings = state.rings.filter(
    ring => ring.age < tuning.ringLife && ring.id > state.nextRing - 1 - MAX_RINGS,
  )

  const base = driftSpeed(tuning.feel.bpm)
  state.spin += dt * base * (0.06 + 1.7 * state.glow + 1.2 * state.burst)
  state.sway += dt * (0.04 + 1.1 * state.glow)
}

/**
 * The one frame Reduce Motion shows: a song mid-chorus, standing still, with
 * two rings out and the bars as the tempo stand-in draws them — the same
 * frame every time for a song, so nothing moves when the screen redraws.
 */
export function stillMotion(state: MotionState, tuning: MotionTuning, source: MotionSourceKind): void {
  const { feel } = tuning
  const level = 0.45 + 0.3 * feel.loudness
  state.source = source
  state.level = level
  state.glow = level
  state.onset = 0
  state.flash = 0
  state.kick = 0.25
  state.burst = 0
  state.spin = STILL_SECONDS * driftSpeed(feel.bpm)
  state.sway = STILL_SECONDS
  state.fired = false
  state.rings = [
    { id: 0, age: tuning.ringLife * 0.62, strength: 0.55 },
    { id: 1, age: tuning.ringLife * 0.28, strength: 0.8 },
  ]
  const levels = synthLevels(state.bands.length, STILL_SECONDS, feel.bpm, feel.energy)
  for (let i = 0; i < state.bands.length; i++) state.bands[i] = levels[i] ?? 0
}

/** How far a ring has travelled, 0–1, easing out as it goes. */
export function ringReach(ring: PulseRing, tuning: MotionTuning): number {
  const p = clamp01(ring.age / tuning.ringLife)
  return 1 - Math.pow(1 - p, 2.2)
}

/** How much of a ring is left to see, 0–1: its strength, fading as it reaches the edge. */
export function ringFade(ring: PulseRing, tuning: MotionTuning): number {
  const p = clamp01(ring.age / tuning.ringLife)
  return Math.pow(1 - p, 1.5) * (0.2 + 0.8 * ring.strength)
}

/* --------------------------------------------------------------- playhead */

/**
 * The phone's playhead between its once-a-second progress ticks.
 *
 * track-player reports the position every second, which is a whole bar of
 * music; the stored curve is 20 frames a second. So between ticks the clock
 * runs on from the last one at the playback rate, snaps to each tick as it
 * comes, stops where it is on a pause and carries on from there on play. It
 * never runs more than a little past a tick that has not come, so a stall
 * holds the drawing rather than letting it race ahead of the sound.
 */
export class PlayheadClock {
  #position = 0
  #at = 0
  #playing = false
  #rate = 1

  /** A progress tick (or a seek): the position the player reported, and when. */
  tick(position: number, now: number): void {
    this.#position = position
    this.#at = now
  }

  /** Play or pause at `now`: a pause keeps where the clock had got to. */
  setPlaying(playing: boolean, now: number): void {
    if (playing === this.#playing) return
    this.#position = this.read(now)
    this.#at = now
    this.#playing = playing
  }

  setRate(rate: number, now: number): void {
    if (rate === this.#rate) return
    this.#position = this.read(now)
    this.#at = now
    this.#rate = rate > 0 ? rate : 1
  }

  /** Seconds into the song at `now` (milliseconds, on the same clock as the ticks). */
  read(now: number): number {
    if (!this.#playing) return this.#position
    const ahead = Math.max(0, Math.min(PLAYHEAD_REACH, (now - this.#at) / 1000))
    return this.#position + ahead * this.#rate
  }
}

/** Seconds the clock may run past its last tick: a tick and a half. */
export const PLAYHEAD_REACH = 1.5

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}
