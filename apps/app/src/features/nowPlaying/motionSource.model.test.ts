import { describe, expect, it } from 'vitest'
import type { FrequencyAnalyser } from '@selfmp3/client'

import {
  beatSampler,
  chooseSampler,
  curveLevel,
  curveSampler,
  liveSampler,
  sampleCurve,
  type MotionCurveLike,
} from './motionSource'
import { visualFeel } from './visuals.model'

const feel = visualFeel(null)

/** A curve from plain numbers: loudness in dBFS and onset 0–1, one per 50 ms frame. */
function curveOf(db: readonly number[], onset: readonly number[]): MotionCurveLike {
  return {
    rate: 20,
    duration: db.length / 20,
    loudness: Uint8Array.from(db, d => Math.round(((Math.max(-60, Math.min(0, d)) + 60) / 60) * 255)),
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
    const empty: MotionCurveLike = { rate: 20, duration: 0, loudness: new Uint8Array(), onset: new Uint8Array() }
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

describe('the curve sampler', () => {
  it('draws low bars in a quiet part and tall ones in a loud part', () => {
    const curve = curveOf([...Array(40).fill(-40), ...Array(40).fill(-8)], Array(80).fill(0))
    const sampler = curveSampler(curve, 7)
    const bands = new Float32Array(24)
    const quiet = sampler.sample(1, bands).level
    const quietMean = bands.reduce((a, b) => a + b, 0) / bands.length
    const loud = sampler.sample(3, bands).level
    const loudMean = bands.reduce((a, b) => a + b, 0) / bands.length
    expect(sampler.source).toBe('curve')
    expect(quiet).toBeLessThan(0.2)
    expect(loud).toBeGreaterThan(0.9)
    expect(loudMean).toBeGreaterThan(quietMean * 3)
  })

  it('lifts the low bands on a hit', () => {
    const onsets = Array(40).fill(0)
    onsets[20] = 1
    const curve = curveOf(Array(40).fill(-15), onsets)
    const before = new Float32Array(24)
    const on = new Float32Array(24)
    curveSampler(curve, 7).sample(0.8, before)
    curveSampler(curve, 7).sample(1, on)
    expect(on[0]!).toBeGreaterThan(before[0]! + 0.3)
  })

  it('does not step over a one-frame hit between two draws', () => {
    const onsets = Array(40).fill(0)
    onsets[21] = 1 // 1.05 s
    const sampler = curveSampler(curveOf(Array(40).fill(-15), onsets), 1)
    const bands = new Float32Array(8)
    sampler.sample(1.0, bands)
    // A slow frame lands at 1.12, well past the hit's own 50 ms.
    expect(sampler.sample(1.12, bands).onset).toBe(1)
    // A seek back reads only where it lands.
    expect(sampler.sample(0.2, bands).onset).toBe(0)
  })

  it('wobbles differently for different songs', () => {
    const curve = curveOf(Array(40).fill(-15), Array(40).fill(0))
    const a = new Float32Array(16)
    const b = new Float32Array(16)
    curveSampler(curve, 1).sample(1, a)
    curveSampler(curve, 2).sample(1, b)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

describe('the live sampler', () => {
  const steady = (byte: number): number[] => Array(128).fill(byte)

  it('reads silence as nothing', () => {
    const sampler = liveSampler(fakeAnalyser(() => steady(0)), () => 0)
    const bands = new Float32Array(16)
    expect(sampler.sample(0, bands)).toEqual({ level: 0, onset: 0 })
    expect(Array.from(bands).every(v => v === 0)).toBe(true)
  })

  it('reads a loud passage higher than a quiet one', () => {
    const bands = new Float32Array(16)
    const quiet = liveSampler(fakeAnalyser(() => steady(120)), () => 0).sample(0, bands).level
    const loud = liveSampler(fakeAnalyser(() => steady(230)), () => 0).sample(0, bands).level
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
    const bands = new Float32Array(16)
    const onsets: number[] = []
    for (let frame = 0; frame < 40; frame++) {
      seconds = frame / 60
      onsets.push(sampler.sample(seconds, bands).onset)
    }
    expect(onsets[hitAt]).toBeGreaterThan(0.9)
    expect(Math.max(...onsets.slice(1, hitAt))).toBe(0)
  })

  it('fills the bands low to high from the usable bins', () => {
    const sampler = liveSampler(fakeAnalyser(() => Array.from({ length: 128 }, (_, i) => 255 - i * 2)), () => 0)
    const bands = new Float32Array(12)
    sampler.sample(0, bands)
    expect(bands[0]!).toBeGreaterThan(bands[11]!)
  })
})

describe('the tempo stand-in', () => {
  it('kicks on the beat and not between', () => {
    const sampler = beatSampler(visualFeel({ bpm: 120, energy: 0.8 } as never))
    const bands = new Float32Array(16)
    expect(sampler.sample(10, bands).onset).toBeGreaterThan(0.8)
    expect(sampler.sample(10.3, bands).onset).toBeLessThan(0.2)
  })
})

describe('choosing a sampler', () => {
  const analyser = fakeAnalyser(() => [])
  const curve = curveOf([-10], [0])

  it('listens where it can, then reads the curve, then keeps the tempo', () => {
    expect(chooseSampler({ canHear: true, analyser, curve, feel, songId: 1 }).source).toBe('live')
    expect(chooseSampler({ canHear: false, analyser, curve, feel, songId: 1 }).source).toBe('curve')
    expect(chooseSampler({ canHear: true, analyser: null, curve, feel, songId: 1 }).source).toBe('curve')
    expect(chooseSampler({ canHear: false, analyser: null, curve: null, feel, songId: 1 }).source).toBe('beat')
    const empty = curveOf([], [])
    expect(chooseSampler({ canHear: false, analyser: null, curve: empty, feel, songId: 1 }).source).toBe('beat')
  })
})
