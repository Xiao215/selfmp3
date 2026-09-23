import { clamp01 } from '@selfmp3/shared'
import type { MotionSampler, MotionSourceKind } from './motionSource.model'
import { valueNoise, type VisualFeel } from './visuals.model'

/**
 * How a visual moves, frame by frame, from what its sampler hears.
 *
 * The browser's canvas and the phone's views both step one of these each
 * frame and then only draw what it holds, so Horizon and Ripples move the
 * same way on every screen. What each takes from it:
 *
 * - Horizon: `hills`, the loudness heard so far, averaged into points that
 *   roll in from the right and pass behind the three hill lines, the front
 *   one quickest; the sun swells on each hit (`swell`) and glows with the
 *   level (`glow`), brighter still on a strong hit (`flash`).
 * - Ripples: a ring leaves the centre on each onset peak — past a threshold,
 *   no sooner than a refractory period after the last one — with its
 *   strength from the onset; the disc kicks on the hit (`kick`) and its halo
 *   follows `glow`.
 *
 * Both follow the sound itself, the song's stored curve or its tempo, in that
 * order (`motionSource.model.ts`): nothing here keeps time on its own. Silence is
 * nearly still: no level, no rings, a flat trail. A paused song steps as
 * silence, so it settles rather than freezing mid-hit, and its hills stop
 * where they are. Pure: vitest runs it.
 */

interface Ring {
  /** Counts up from the first ring, so a phone can keep each ring in the same view. */
  readonly id: number
  /** Seconds since it left the centre. */
  age: number
  /** 0–1, from the onset that sent it and how loud the song was then. */
  readonly strength: number
}

/**
 * One of Horizon's hill lines: the level heard, averaged over `slot` seconds
 * a point. A point takes `HILL_LAYERS[i].seconds` to cross the width, so the
 * back line (long slots) moves slowly and smooths a whole passage into one
 * rise, and the front line (short slots) moves quickly and shows the phrase.
 */
interface HillTrail {
  /** Seconds each point stands for. */
  readonly slot: number
  /** The points, oldest first: the last is the newest whole slot, still just off the right edge. */
  readonly levels: Float32Array
  /** Seconds heard into the slot being filled: the line has moved this share of a point to the left. */
  elapsed: number
  /** The level summed over `elapsed`. */
  sum: number
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
  /** 0–1, Ripples' disc kick on each ring sent, gone in about a tenth of a second. */
  kick: number
  /** 0–1, Horizon's sun swelling on each hit and easing back over about a third of a second. */
  swell: number
  /** Horizon's lines, back to front (`HILL_LAYERS`). */
  hills: HillTrail[]
  /** Whether the hills moved on this frame: they stand still only while paused. */
  travelled: boolean
  /** The rings on screen, oldest first. */
  rings: Ring[]
  /** Whether a ring left on this frame. */
  fired: boolean
  // What the onset trigger remembers.
  clock: number
  lastFire: number
  armed: boolean
  peakSinceFire: number
  nextRing: number
}

/**
 * Horizon's three lines, back to front: how long a point takes to cross the
 * width (P23's 22, 15 and 9 seconds), how many gaps between points span it,
 * where the line's foot sits and how far a loud point rises above it, both as
 * shares of the height. The nearer the line, the lower, quicker and finer.
 */
export const HILL_LAYERS = [
  { seconds: 22, gaps: 8, base: 0.6, rise: 0.15 },
  { seconds: 15, gaps: 10, base: 0.67, rise: 0.12 },
  { seconds: 9, gaps: 12, base: 0.74, rise: 0.1 },
] as const

/**
 * Points a line keeps: one beyond each edge, so the line is whole as it
 * scrolls, and the newest waiting off the right edge to roll in.
 */
export const hillPoints = (gaps: number): number => gaps + 3

/** Where a line's point `i` sits across a width, `shift` (0–1) of a gap along its way left. */
export function hillX(i: number, shift: number, width: number, gaps: number): number {
  return (i - 1 - shift) * (width / gaps)
}

/** How far up its rise a point stands, 0–1: a floor in silence, so the hills never go flat. */
export function hillShare(level: number): number {
  return 0.15 + 0.85 * clamp01(level)
}

/** How far the line has moved into its next gap, 0–1. */
export const hillShift = (trail: HillTrail): number => clamp01(trail.elapsed / trail.slot)

/**
 * A new state. Its hills start as a quiet landscape at the song's loudness,
 * not flat, because a line takes up to 22 seconds to fill with what was
 * heard; the first real points roll in from the right straight away.
 */
export function createMotionState(loudness: number): MotionState {
  return {
    source: 'beat',
    level: 0,
    glow: 0,
    onset: 0,
    flash: 0,
    kick: 0,
    swell: 0,
    hills: HILL_LAYERS.map((layer, index) => ({
      slot: layer.seconds / layer.gaps,
      levels: seededHills(hillPoints(layer.gaps), index, loudness),
      elapsed: 0,
      sum: 0,
    })),
    travelled: false,
    rings: [],
    fired: false,
    clock: 0,
    lastFire: -Infinity,
    armed: true,
    peakSinceFire: 0,
    nextRing: 0,
  }
}

function seededHills(count: number, layer: number, loudness: number): Float32Array {
  const levels = new Float32Array(count)
  for (let i = 0; i < count; i++)
    levels[i] = clamp01(loudness * (0.35 + 0.6 * valueNoise(i * 0.8 + layer * 5.3, layer * 1.7)))
  return levels
}

/** An onset at or above this can send a ring. */
const ONSET_THRESHOLD = 0.45
/** After a ring, the onset has to fall to this share of its peak before another can go. */
const REARM_SHARE = 0.6
/** Below this level nothing is a hit: the hiss of a fade-out does not ring. */
const QUIET_LEVEL = 0.04
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
 * One frame. `playing` false steps as silence (the sampler is not asked) and
 * holds the hills where they are; `dt` 0 changes nothing at all, for a frame
 * drawn twice.
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
  state.travelled = false
  state.source = sampler.source
  if (!(dt > 0)) return
  let level = 0
  let onset = 0
  if (playing) {
    const heard = sampler.sample(seconds)
    level = clamp01(heard.level)
    onset = clamp01(heard.onset)
    for (const trail of state.hills) listen(trail, level, dt)
    state.travelled = true
  }
  state.level = level
  state.onset = onset
  state.clock += dt

  state.glow += (level - state.glow) * ease(dt, 0.3)

  state.kick *= Math.exp(-dt / 0.12)
  state.flash *= Math.exp(-dt / 0.25)
  state.swell *= Math.exp(-dt / 0.35)

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
    state.swell = Math.max(state.swell, strength)
    // Only a strong hit flashes: the start of a chorus, not every hi-hat.
    state.flash = Math.max(state.flash, clamp01((onset - 0.65) / 0.35) * presence)
  } else if (!state.armed) {
    state.peakSinceFire = Math.max(state.peakSinceFire, onset)
    if (onset < state.peakSinceFire * REARM_SHARE || onset < ONSET_THRESHOLD * REARM_SHARE)
      state.armed = true
  }

  for (const ring of state.rings) ring.age += dt
  state.rings = state.rings.filter(
    ring => ring.age < tuning.ringLife && ring.id > state.nextRing - 1 - MAX_RINGS,
  )
}

/** Adds a frame's level to a line; a whole slot becomes its newest point and the rest move up one. */
function listen(trail: HillTrail, level: number, dt: number): void {
  trail.elapsed += dt
  trail.sum += level * dt
  if (trail.elapsed < trail.slot) return
  const levels = trail.levels
  levels.copyWithin(0, 1)
  levels[levels.length - 1] = trail.sum / trail.elapsed
  // What spilled past the slot starts the next one, so a slow frame does not lose time.
  trail.elapsed = Math.min(trail.slot, trail.elapsed - trail.slot)
  trail.sum = level * trail.elapsed
}

/**
 * The one frame Reduce Motion shows: a song mid-chorus, standing still — the
 * sun a little swollen, two rings out, the hills the quiet landscape a song
 * starts with — the same frame every time for a song, so nothing moves when
 * the screen redraws.
 */
export function stillMotion(
  state: MotionState,
  tuning: MotionTuning,
  source: MotionSourceKind,
): void {
  const { feel } = tuning
  const level = 0.45 + 0.3 * feel.loudness
  state.source = source
  state.level = level
  state.glow = level
  state.onset = 0
  state.flash = 0
  state.kick = 0.25
  state.swell = 0.3
  state.fired = false
  state.travelled = false
  state.rings = [
    { id: 0, age: tuning.ringLife * 0.62, strength: 0.55 },
    { id: 1, age: tuning.ringLife * 0.28, strength: 0.8 },
  ]
  state.hills = createMotionState(feel.loudness).hills
}

/** How far a ring has travelled, 0–1, easing out as it goes. */
export function ringReach(ring: Ring, tuning: MotionTuning): number {
  const p = clamp01(ring.age / tuning.ringLife)
  return 1 - Math.pow(1 - p, 2.2)
}

/** How much of a ring is left to see, 0–1: its strength, fading as it reaches the edge. */
export function ringFade(ring: Ring, tuning: MotionTuning): number {
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
