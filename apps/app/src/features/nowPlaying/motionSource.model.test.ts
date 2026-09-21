import { describe, expect, it } from 'vitest'
import type { FrequencyAnalyser } from '@selfmp3/client'

import {
  beatSampler,
  chooseSampler,
  curveHits,
  curveLevel,
  curveSampler,
  liveSampler,
  sampleCurve,
  type MotionCurveLike,
} from './motionSource.model'
import { visualFeel } from './visuals.model'

const feel = visualFeel(null)

/** A curve from plain numbers: loudness in dBFS and onset 0–1, one per 50 ms frame. */
function curveOf(db: readonly number[], onset: readonly number[]): MotionCurveLike {
  return {
    rate: 20,
    duration: db.length / 20,
    loudness: Uint8Array.from(db, d =>
      Math.round(((Math.max(-60, Math.min(0, d)) + 60) / 60) * 255),
    ),
    onset: Uint8Array.from(onset, o => Math.round(o * 255)),
  }
}

/** An analyser that answers from a function of the call count. */
function fakeAnalyser(frame: (call: number) => number[]): FrequencyAnalyser {
  let call = 0
  return {
    frequencyBinCount: 128,
    getByteFrequencyData(into: Uint8Array) {
      const values = frame(call++)
      for (let i = 0; i < into.length; i++) into[i] = values[i] ?? 0
    },
  }
}

describe('reading the stored curve', () => {
  const curve: MotionCurveLike = {
    rate: 20,
    duration: 0.15,
    loudness: Uint8Array.from([0, 255, 51]),
    onset: Uint8Array.from([255, 0, 0]),
  }

  it('interpolates between frames', () => {
    expect(sampleCurve(curve, 0).level).toBe(0)
    expect(sampleCurve(curve, 0.025).level).toBeCloseTo(0.5)
    expect(sampleCurve(curve, 0.025).onset).toBeCloseTo(0.5)
    expect(sampleCurve(curve, 0.05).level).toBe(1)
  })

  it('holds the last frame, and is silent before the start and past the end', () => {
    expect(sampleCurve(curve, 0.12).level).toBeCloseTo(0.2)
    expect(sampleCurve(curve, 0.15)).toEqual({ level: 0, onset: 0 })
    expect(sampleCurve(curve, -1)).toEqual({ level: 0, onset: 0 })
    expect(sampleCurve(curve, Number.NaN)).toEqual({ level: 0, onset: 0 })
  })

  it('is silent for an empty curve', () => {
    const empty: MotionCurveLike = {
      rate: 20,
      duration: 0,
      loudness: new Uint8Array(),
      onset: new Uint8Array(),
    }
    expect(sampleCurve(empty, 0)).toEqual({ level: 0, onset: 0 })
  })

  it('keeps a quiet passage quiet and lets a loud chorus reach the top', () => {
    expect(curveLevel(0)).toBe(0)
    expect(curveLevel((-50 + 60) / 60)).toBe(0)
    expect(curveLevel((-30 + 60) / 60)).toBeLessThan(0.4)
    expect(curveLevel((-9 + 60) / 60)).toBeCloseTo(1)
    expect(curveLevel(1)).toBe(1)
  })
})

describe('finding hits in the stored curve', () => {
  it('finds each hit in a dense chorus whose onset sits near the top every frame', () => {
    // 4 s at 20 fps: onset 0.86–0.9 throughout, a full-scale hit every half second.
    const onset = Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? 1 : 0.86 + (i % 3) * 0.02))
    const hits = curveHits(
      Uint8Array.from(onset, o => Math.round(o * 255)),
      20,
    )
    const fired = [...hits].flatMap((h, i) => (h >= 0.45 ? [i] : []))
    expect(fired).toEqual([0, 10, 20, 30, 40, 50, 60, 70])
  })

  it('never fires on a quiet floor or on a steady plateau', () => {
    const quiet = curveHits(Uint8Array.from(Array(40).fill(20)), 20)
    const plateau = curveHits(Uint8Array.from(Array(40).fill(230)), 20)
    expect([...quiet].every(h => h === 0)).toBe(true)
    expect([...plateau].every(h => h === 0)).toBe(true)
  })

  it('lets a chorus ring again after each hit, where the raw onset never falls', () => {
    const onset = Array.from({ length: 80 }, (_, i) => (i % 10 === 0 ? 1 : 0.88))
    const sampler = curveSampler(curveOf(Array(80).fill(-10), onset))
    const rings: number[] = []
    let armed = true
    for (let frame = 0; frame < 120; frame++) {
      const seconds = frame / 30
      const { onset: hit } = sampler.sample(seconds)
      if (armed && hit >= 0.45) {
        rings.push(Math.round(seconds * 2) / 2)
        armed = false
      } else if (hit < 0.27) armed = true
    }
    expect(rings).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })
})

describe('the curve sampler', () => {
  it('reads a quiet part low and a loud part high', () => {
    const curve = curveOf([...Array(40).fill(-40), ...Array(40).fill(-8)], Array(80).fill(0))
    const sampler = curveSampler(curve)
    expect(sampler.source).toBe('curve')
    expect(sampler.sample(1).level).toBeLessThan(0.2)
    expect(sampler.sample(3).level).toBeGreaterThan(0.9)
  })

  it('does not step over a one-frame hit between two draws', () => {
    const onsets = Array(40).fill(0)
    onsets[21] = 1 // 1.05 s
    const sampler = curveSampler(curveOf(Array(40).fill(-15), onsets))
    sampler.sample(1.0)
    // A slow frame lands at 1.12, well past the hit's own 50 ms.
    expect(sampler.sample(1.12).onset).toBe(1)
    // A seek back reads only where it lands.
    expect(sampler.sample(0.2).onset).toBe(0)
  })
})

describe('the live sampler', () => {
  const steady = (byte: number): number[] => Array(128).fill(byte)

  it('reads silence as nothing', () => {
    const sampler = liveSampler(
      fakeAnalyser(() => steady(0)),
      () => 0,
    )
    expect(sampler.sample(0)).toEqual({ level: 0, onset: 0 })
  })

  it('reads a loud passage higher than a quiet one', () => {
    const quiet = liveSampler(
      fakeAnalyser(() => steady(120)),
      () => 0,
    ).sample(0).level
    const loud = liveSampler(
      fakeAnalyser(() => steady(230)),
      () => 0,
    ).sample(0).level
    expect(loud).toBeGreaterThan(quiet * 1.8)
    expect(loud).toBeLessThanOrEqual(1)
  })

  it('finds a hit as a rise in the low bins, and not in a steady tone', () => {
    let seconds = 0
    const hitAt = 30
    const sampler = liveSampler(
      fakeAnalyser(call => {
        const bins = steady(150)
        if (call === hitAt) for (let i = 0; i < 16; i++) bins[i] = 240
        return bins
      }),
      () => seconds,
    )
    const onsets: number[] = []
    for (let frame = 0; frame < 40; frame++) {
      seconds = frame / 60
      onsets.push(sampler.sample(seconds).onset)
    }
    expect(onsets[hitAt]).toBeGreaterThan(0.9)
    expect(Math.max(...onsets.slice(1, hitAt))).toBe(0)
  })

  it('does not read a seek as a hit', () => {
    let seconds = 0
    let spectrum = 60
    const sampler = liveSampler(
      fakeAnalyser(() => steady(spectrum)),
      () => seconds,
    )
    const onsets: number[] = []
    for (let frame = 0; frame < 60; frame++) {
      // A seek at frame 20: the playhead jumps a minute and the spectrum with it.
      if (frame === 20) spectrum = 220
      const playhead = frame < 20 ? frame / 60 : 60 + frame / 60
      seconds = frame / 60
      onsets.push(sampler.sample(playhead).onset)
    }
    expect(Math.max(...onsets)).toBe(0)
  })

  it('hears a hit in a loud chorus whose bass sits at the top of the byte range', () => {
    // An AnalyserNode: in decibels, the kick rises from -20 to -8 dB, both
    // above the -30 dB top where every byte would read 255.
    let call = 0
    let seconds = 0
    const node = {
      frequencyBinCount: 128,
      minDecibels: -100,
      maxDecibels: -30,
      getByteFrequencyData(into: Uint8Array) {
        into.fill(255)
      },
      getFloatFrequencyData(into: Float32Array) {
        into.fill(-20)
        if (call === 30) for (let i = 0; i < 16; i++) into[i] = -8
        call++
      },
    }
    const sampler = liveSampler(node, () => seconds)
    const onsets: number[] = []
    for (let frame = 0; frame < 40; frame++) {
      seconds = frame / 60
      onsets.push(sampler.sample(seconds).onset)
    }
    expect(onsets[30]).toBeGreaterThan(0.9)
    expect(Math.max(...onsets.slice(1, 30))).toBe(0)
  })
})

describe('the tempo stand-in', () => {
  it('kicks on the beat and not between', () => {
    const sampler = beatSampler(visualFeel({ bpm: 120, energy: 0.8 } as never))
    expect(sampler.sample(10).onset).toBeGreaterThan(0.8)
    expect(sampler.sample(10.3).onset).toBeLessThan(0.2)
  })
})

describe('choosing a sampler', () => {
  const analyser = fakeAnalyser(() => [])
  const curve = curveOf([-10], [0])

  it('listens where it can, then reads the curve, then keeps the tempo', () => {
    expect(chooseSampler({ canHear: true, analyser, curve, feel }).source).toBe('live')
    expect(chooseSampler({ canHear: false, analyser, curve, feel }).source).toBe('curve')
    expect(chooseSampler({ canHear: true, analyser: null, curve, feel }).source).toBe('curve')
    expect(chooseSampler({ canHear: false, analyser: null, curve: null, feel }).source).toBe('beat')
    const empty = curveOf([], [])
    expect(chooseSampler({ canHear: false, analyser: null, curve: empty, feel }).source).toBe(
      'beat',
    )
  })
})
