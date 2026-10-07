import { clamp01 } from '@selfmp3/shared'
import type { MotionSampler, MotionSourceKind } from './motionSource.model'
import type { VisualFeel } from './visuals.model'

/**
 * How a visual moves, frame by frame, from what its sampler hears.
 *
 * The browser's canvas and the phone's views both step one of these each
 * frame and then only draw what it holds, so Ripples moves the same way on
 * every screen: a ring leaves the centre on each onset peak — past a
 * threshold, no sooner than a refractory period after the last one — with its
 * strength from the onset; the disc kicks on the hit (`kick`), its halo
 * follows `glow`, and the ground brightens a touch on a strong hit (`flash`).
 *
 * It follows the sound itself, the song's stored curve or its tempo, in that
 * order (`motionSource.model.ts`): nothing here keeps time on its own. Silence
 * is nearly still: no level, no rings. A paused song steps as silence, so it
 * settles rather than freezing mid-hit; `isSettled` is when it has finished
 * doing that, which is when both twins stop asking for frames. Even which ink a ring draws in is here
 * (`ringInk`), because the two used to answer that differently. Pure: vitest
 * runs it.
 */

interface Ring {
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
  /** 0–1, the disc's kick on each ring sent, gone in about a tenth of a second. */
  kick: number
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

/** A new state: silent, with no rings out. */
export function createMotionState(): MotionState {
  return {
    source: 'beat',
    level: 0,
    glow: 0,
    onset: 0,
    flash: 0,
    kick: 0,
    rings: [],
    fired: false,
    clock: 0,
    lastFire: -Infinity,
    armed: true,
    peakSinceFire: 0,
    nextRing: 0,
  }
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
 * One frame. `playing` false steps as silence (the sampler is not asked); `dt`
 * 0 changes nothing at all, for a frame drawn twice.
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
    const heard = sampler.sample(seconds)
    level = clamp01(heard.level)
    onset = clamp01(heard.onset)
  }
  state.level = level
  state.onset = onset
  state.clock += dt

  state.glow += (level - state.glow) * ease(dt, 0.3)

  state.kick *= Math.exp(-dt / 0.12)
  state.flash *= Math.exp(-dt / 0.25)

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
    // Only a strong hit flashes: the start of a chorus, not every hi-hat.
    state.flash = Math.max(state.flash, clamp01((onset - 0.65) / 0.35) * presence)
  } else if (!state.armed) {
    state.peakSinceFire = Math.max(state.peakSinceFire, onset)
    if (onset < state.peakSinceFire * REARM_SHARE || onset < ONSET_THRESHOLD * REARM_SHARE)
      state.armed = true
  }

  // Kept in place rather than filtered into a new array: this runs every frame.
  let kept = 0
  for (const ring of state.rings) {
    ring.age += dt
    if (ring.age < tuning.ringLife && ring.id > state.nextRing - 1 - MAX_RINGS) {
      state.rings[kept++] = ring
    }
  }
  state.rings.length = kept
}

/**
 * The one frame Reduce Motion shows: a song mid-chorus, standing still — the
 * disc a little kicked, two rings out — the same frame every time for a song,
 * so nothing moves when the screen redraws.
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
  state.fired = false
  state.rings = [
    { id: 0, age: tuning.ringLife * 0.62, strength: 0.55 },
    { id: 1, age: tuning.ringLife * 0.28, strength: 0.8 },
  ]
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

/** Which ink each ring draws in, in turn: the lead, then the other two, as P24's rings take turns. */
export const RING_INKS = [2, 0, 1] as const

/** Which of the three inks: narrow enough to index a palette's `inks` with. */
type RingInk = (typeof RING_INKS)[number]

/**
 * Which of a palette's three inks the ring with this id draws in. Rings count
 * up from the first one of a song, so consecutive rings take turns.
 *
 * Both twins ask this, and they used to each have their own copy of the rule.
 * The browser coloured a ring by its own id; the phone keeps one view per ring
 * slot and colours that view once, when it is made, by the slot — a border
 * colour is a paint prop, so changing it mid-flight would be a shadow-tree
 * commit, and the view a ring lands in is `id % MAX_RINGS`. Those two agree
 * only while `MAX_RINGS` is a whole number of turns of `RING_INKS`, which is
 * what `ringInk(id) === ringInk(id % MAX_RINGS)` says and a vitest case holds:
 * break it and the same song would colour its rings differently on a phone and
 * in a browser.
 */
export function ringInk(id: number): RingInk {
  return RING_INKS[id % RING_INKS.length]!
}

/**
 * Whether the visual has anything left to move, so a paused one can ask for no
 * more frames: nothing is fading (the glow, the kick and the flash are all as
 * good as zero) and its last ring is off the edge. Both twins stop their loop
 * on this and start it again on play.
 */
export function isSettled(m: MotionState): boolean {
  if (m.glow > 0.002 || m.kick > 0.002 || m.flash > 0.002) return false
  return m.rings.length === 0
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
