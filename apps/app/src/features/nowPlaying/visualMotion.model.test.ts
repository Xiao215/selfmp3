import { describe, expect, it } from 'vitest'

import { curveSampler, type MotionCurveLike, type MotionSampler } from './motionSource'
import {
  createMotionState,
  DEFAULT_REFRACTORY,
  HILL_LAYERS,
  hillPoints,
  hillShare,
  hillShift,
  hillX,
  MAX_RINGS,
  motionTuning,
  PlayheadClock,
  PLAYHEAD_REACH,
  ringFade,
  stepMotion,
  stillMotion,
} from './visualMotion.model'
import { visualFeel } from './visuals.model'

const feel = visualFeel(null)
const DT = 1 / 60

/** A sampler that answers from a function of the playhead. */
function scripted(at: (seconds: number) => { level: number; onset: number }): MotionSampler {
  return {
    source: 'curve',
    sample(seconds) {
      return at(seconds)
    },
  }
}

/** Steps `seconds` of frames, returning the playheads where a ring left. */
function run(sampler: MotionSampler, seconds: number, tuning = motionTuning(feel, false)) {
  const state = createMotionState(0.5)
  const fired: number[] = []
  const glow: number[] = []
  for (let frame = 0; frame * DT < seconds; frame++) {
    const t = frame * DT
    stepMotion(state, sampler, t, DT, true, tuning)
    if (state.fired) fired.push(t)
    glow.push(state.glow)
  }
  return { state, fired, glow }
}

describe('rings on the hits', () => {
  it('sends a ring on each onset peak and none in silence', () => {
    // Silent for 3 s, then a hit every half second at a loud level.
    const hit = (t: number): boolean => t >= 3 && (t - 3) % 0.5 < 0.05
    const { fired } = run(
      scripted(t => ({ level: t < 3 ? 0 : 0.8, onset: hit(t) ? 1 : 0.05 })),
      6,
    )
    expect(fired.filter(t => t < 3)).toEqual([])
    expect(fired).toHaveLength(6)
    fired.forEach((t, i) => expect(t).toBeCloseTo(3 + i * 0.5, 1))
  })

  it('keeps a refractory gap: a beat-long swell rings once, not every frame', () => {
    const { fired } = run(
      scripted(() => ({ level: 0.7, onset: 0.9 })),
      1,
    )
    expect(fired).toHaveLength(1)
  })

  it('waits about six tenths of a beat at a known tempo', () => {
    const tuning = motionTuning(visualFeel({ bpm: 120 } as never), true)
    expect(tuning.refractory).toBeCloseTo(0.3)
    expect(motionTuning(feel, false).refractory).toBe(DEFAULT_REFRACTORY)
    // Hits every 0.2 s at 120 BPM: only every other one can ring.
    const hit = (t: number): boolean => t % 0.2 < 0.02
    const { fired } = run(
      scripted(() => ({ level: 0.7, onset: 0 })),
      0,
    ) // warm the types
    expect(fired).toEqual([])
    const flicker = run(
      scripted(t => ({ level: 0.7, onset: hit(t) ? 1 : 0 })),
      2,
      tuning,
    ).fired
    for (let i = 1; i < flicker.length; i++)
      expect(flicker[i]! - flicker[i - 1]!).toBeGreaterThanOrEqual(0.3)
  })

  it('makes a quiet hit fainter than a loud one', () => {
    const tuning = motionTuning(feel, false)
    const quiet = run(
      scripted(t => ({ level: 0.1, onset: t < 0.05 ? 1 : 0 })),
      0.2,
    ).state
    const loud = run(
      scripted(t => ({ level: 0.9, onset: t < 0.05 ? 1 : 0 })),
      0.2,
    ).state
    expect(ringFade(quiet.rings[0]!, tuning)).toBeLessThan(ringFade(loud.rings[0]!, tuning))
  })

  it('never keeps more rings than the phone has views for', () => {
    const { state } = run(
      scripted(t => ({ level: 1, onset: t % 0.2 < 0.02 ? 1 : 0 })),
      3,
    )
    expect(state.rings.length).toBeLessThanOrEqual(MAX_RINGS)
  })
})

describe('following the level', () => {
  it('glows with the level, smoothed over about 300 ms', () => {
    const { glow } = run(
      scripted(() => ({ level: 1, onset: 0 })),
      1,
    )
    expect(glow[Math.round(0.3 / DT)]!).toBeGreaterThan(0.55)
    expect(glow[Math.round(0.3 / DT)]!).toBeLessThan(0.75)
    expect(glow.at(-1)!).toBeGreaterThan(0.95)
  })

  it('settles when paused instead of freezing mid-hit', () => {
    const tuning = motionTuning(feel, false)
    const { state } = run(
      scripted(() => ({ level: 1, onset: 0 })),
      1,
    )
    for (let i = 0; i < 120; i++)
      stepMotion(
        state,
        scripted(() => ({ level: 1, onset: 1 })),
        1,
        DT,
        false,
        tuning,
      )
    expect(state.glow).toBeLessThan(0.01)
    expect(state.swell).toBeLessThan(0.01)
    expect(state.rings).toEqual([])
  })
})

describe('Horizon’s hills', () => {
  const tuning = motionTuning(feel, false)
  const front = HILL_LAYERS.length - 1

  it('turns what was heard into points that roll in from the right', () => {
    const state = createMotionState(0)
    const trail = state.hills[front]!
    // Loud for exactly one front slot, then quiet.
    const loudFor = trail.slot
    for (let t = 0; t < loudFor + trail.slot * 3; t += DT)
      stepMotion(
        state,
        scripted(s => ({ level: s < loudFor ? 0.9 : 0.1, onset: 0 })),
        t,
        DT,
        true,
        tuning,
      )
    const levels = Array.from(trail.levels)
    const loudest = levels.indexOf(Math.max(...levels))
    // Three quiet slots have come in after it, on the right.
    expect(loudest).toBe(levels.length - 4)
    expect(levels[loudest]!).toBeGreaterThan(0.8)
    expect(levels.at(-1)!).toBeCloseTo(0.1, 1)
  })

  it('moves the front line quickest, and a point crosses the width in its time', () => {
    const slots = HILL_LAYERS.map(layer => layer.seconds / layer.gaps)
    expect(slots[0]!).toBeGreaterThan(slots[1]!)
    expect(slots[1]!).toBeGreaterThan(slots[2]!)
    const layer = HILL_LAYERS[front]!
    expect(hillX(1, 0, 390, layer.gaps)).toBe(0)
    expect(hillX(1 + layer.gaps, 0, 390, layer.gaps)).toBeCloseTo(390)
    // The newest point waits beyond the right edge; the oldest is gone past the left.
    const last = hillPoints(layer.gaps) - 1
    expect(hillX(last, 1, 390, layer.gaps)).toBeGreaterThanOrEqual(390)
    expect(hillX(0, 0, 390, layer.gaps)).toBeLessThan(0)
  })

  it('slides smoothly: nearly a whole gap along just before a new point comes in', () => {
    const state = createMotionState(0.5)
    const trail = state.hills[front]!
    const steps = Math.round(trail.slot / DT) - 1
    for (let i = 0; i < steps; i++)
      stepMotion(
        state,
        scripted(() => ({ level: 0.5, onset: 0 })),
        i * DT,
        DT,
        true,
        tuning,
      )
    expect(hillShift(trail)).toBeGreaterThan(0.9)
    expect(hillShift(trail)).toBeLessThanOrEqual(1)
  })

  it('stands still while paused, and keeps a floor in silence', () => {
    const state = createMotionState(0.5)
    const before = Array.from(state.hills[front]!.levels)
    for (let i = 0; i < 600; i++)
      stepMotion(
        state,
        scripted(() => ({ level: 1, onset: 0 })),
        0,
        DT,
        false,
        tuning,
      )
    expect(Array.from(state.hills[front]!.levels)).toEqual(before)
    expect(state.hills[front]!.elapsed).toBe(0)
    expect(state.travelled).toBe(false)
    expect(hillShare(0)).toBeGreaterThan(0)
    expect(hillShare(1)).toBe(1)
  })

  it('swells the sun on a hit and lets it ease back', () => {
    const { state } = run(
      scripted(t => ({ level: 0.8, onset: t < 0.05 ? 1 : 0 })),
      0.1,
    )
    const swollen = state.swell
    expect(swollen).toBeGreaterThan(0.5)
    for (let i = 0; i < 60; i++)
      stepMotion(
        state,
        scripted(() => ({ level: 0.8, onset: 0 })),
        1,
        DT,
        true,
        tuning,
      )
    expect(state.swell).toBeLessThan(swollen / 10)
  })
})

describe('a synthetic curve, end to end', () => {
  it('rings only on the hits after a silent start', () => {
    const frames = 20 * 8
    const loudness = new Uint8Array(frames)
    const onset = new Uint8Array(frames)
    for (let i = 60; i < frames; i++) {
      loudness[i] = 230
      onset[i] = i % 10 === 0 ? 255 : 20
    }
    const curve: MotionCurveLike = { rate: 20, duration: 8, loudness, onset }
    const { fired } = run(curveSampler(curve, 36), 8)
    // The first hit's frame starts at 3 s; interpolation reaches it a drawn frame early.
    expect(fired.filter(t => t < 2.95)).toEqual([])
    expect(fired.length).toBe(10)
    for (const t of fired) expect(Math.abs(t * 2 - Math.round(t * 2))).toBeLessThan(0.1)
  })
})

describe('the still frame', () => {
  it('is the same every time, with rings out', () => {
    const tuning = motionTuning(feel, false)
    const a = createMotionState(0.2)
    const b = createMotionState(0.9)
    stillMotion(a, tuning, 'curve')
    stillMotion(b, tuning, 'curve')
    expect(a).toEqual(b)
    expect(a.rings.length).toBeGreaterThan(0)
  })
})

describe('the phone playhead between ticks', () => {
  it('runs on from a tick while playing, and snaps to the next', () => {
    const clock = new PlayheadClock()
    clock.tick(10, 0)
    clock.setPlaying(true, 0)
    expect(clock.read(400)).toBeCloseTo(10.4)
    clock.tick(10.9, 1000)
    expect(clock.read(1000)).toBeCloseTo(10.9)
    expect(clock.read(1250)).toBeCloseTo(11.15)
  })

  it('stops where it had got to on a pause, and carries on from there', () => {
    const clock = new PlayheadClock()
    clock.setPlaying(true, 0)
    clock.tick(5, 0)
    clock.setPlaying(false, 600)
    expect(clock.read(5000)).toBeCloseTo(5.6)
    clock.setPlaying(true, 5000)
    expect(clock.read(5100)).toBeCloseTo(5.7)
  })

  it('follows the playback rate, and never races far past a missing tick', () => {
    const clock = new PlayheadClock()
    clock.setPlaying(true, 0)
    clock.tick(0, 0)
    clock.setRate(2, 0)
    expect(clock.read(500)).toBeCloseTo(1)
    expect(clock.read(60_000)).toBeCloseTo(PLAYHEAD_REACH * 2)
  })
})
