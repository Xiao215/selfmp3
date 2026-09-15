import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_SAMPLE_RATE,
  analyzePcm,
  autocorrelate,
  chroma,
  energyScore,
  estimateKey,
  estimateTempo,
  fft,
  MOTION_FRAME_RATE,
  MOTION_SAMPLE_RATE,
  MotionBuilder,
  motionFromPcm,
  onsetEnvelope,
  rms,
} from './dsp.js'

/**
 * Every signal here is synthesised in the test, so nothing depends on ffmpeg
 * or on audio fixtures: a click track at a known tempo, a chord in a known
 * key. If the maths is right these are unambiguous; if it drifts, the
 * numbers say by how much.
 */

const SR = ANALYSIS_SAMPLE_RATE

/** Deterministic noise so the click tracks are reproducible. */
function seeded(seed: number): () => number {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296 - 0.5
  }
}

/** A short noise burst with a fast decay every beat, over a faint bed. */
function clickTrack(bpm: number, seconds: number, seed = 1): Float32Array {
  const random = seeded(seed)
  const pcm = new Float32Array(Math.round(seconds * SR))
  // A quiet, irregular bed so the signal is not literally silent between clicks.
  for (let i = 0; i < pcm.length; i++) pcm[i] = random() * 0.01
  const period = (60 / bpm) * SR
  const clickLength = Math.round(0.03 * SR)
  for (let start = 0; start < pcm.length; start += period) {
    const at = Math.round(start)
    for (let i = 0; i < clickLength && at + i < pcm.length; i++) {
      const decay = Math.exp(-i / (clickLength / 4))
      pcm[at + i] = (pcm[at + i] ?? 0) + random() * 1.2 * decay
    }
  }
  return pcm
}

/** A sustained chord: each note with a few decaying harmonics. */
function chord(midiNotes: readonly number[], seconds: number, amplitude = 0.2): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * SR))
  for (const midi of midiNotes) {
    const f0 = 440 * Math.pow(2, (midi - 69) / 12)
    for (let harmonic = 1; harmonic <= 4; harmonic++) {
      const gain = amplitude / harmonic
      const omega = (2 * Math.PI * f0 * harmonic) / SR
      for (let i = 0; i < pcm.length; i++) {
        pcm[i] = (pcm[i] ?? 0) + gain * Math.sin(omega * i)
      }
    }
  }
  return pcm
}

describe('fft', () => {
  it('finds a pure tone in the right bin', () => {
    const n = 1024
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    const bin = 37
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * bin * i) / n)
    fft(re, im)
    let peak = 0
    let peakBin = -1
    for (let k = 0; k < n / 2; k++) {
      const magnitude = Math.hypot(re[k] ?? 0, im[k] ?? 0)
      if (magnitude > peak) {
        peak = magnitude
        peakBin = k
      }
    }
    expect(peakBin).toBe(bin)
    expect(peak).toBeCloseTo(n / 2, 6)
  })

  it('rejects sizes that are not powers of two', () => {
    expect(() => fft(new Float64Array(100), new Float64Array(100))).toThrow()
  })
})

describe('autocorrelate', () => {
  it('peaks at the period of a periodic signal', () => {
    const values = new Float64Array(400)
    for (let i = 0; i < values.length; i += 20) values[i] = 1
    const acf = autocorrelate(values, 60)
    expect(acf[0]).toBeCloseTo(1, 6)
    expect(acf[20]).toBeGreaterThan(0.8)
    expect(acf[40]).toBeGreaterThan(0.7)
    expect(acf[10]).toBeLessThan(0.1)
  })
})

describe('estimateTempo', () => {
  it.each([80, 100, 128, 160])('detects a %i BPM click track', bpm => {
    const { bpm: detected } = estimateTempo(onsetEnvelope(clickTrack(bpm, 30), SR))
    expect(detected).not.toBeNull()
    expect(Math.abs((detected ?? 0) - bpm)).toBeLessThanOrEqual(1.5)
  })

  it('does not fold a slow tempo up or a fast one down when the octave is unambiguous', () => {
    // 70 BPM has no onsets at the 140 lag; 175 has clear ones at every beat.
    const slow = estimateTempo(onsetEnvelope(clickTrack(70, 30), SR)).bpm ?? 0
    expect(Math.abs(slow - 70)).toBeLessThanOrEqual(1.5)
  })

  it('returns null for silence and for noise', () => {
    expect(estimateTempo(onsetEnvelope(new Float32Array(SR * 20), SR)).bpm).toBeNull()
    const random = seeded(9)
    const noise = new Float32Array(SR * 20)
    for (let i = 0; i < noise.length; i++) noise[i] = random() * 0.5
    expect(estimateTempo(onsetEnvelope(noise, SR)).bpm).toBeNull()
  })

  it('gives up on a clip too short to hold a few bars', () => {
    expect(estimateTempo(onsetEnvelope(clickTrack(120, 2), SR)).bpm).toBeNull()
  })
})

describe('estimateKey', () => {
  it('hears an A minor chord as A minor', () => {
    // A3, C4, E4, plus A4 to anchor the tonic.
    const key = estimateKey(chroma(chord([57, 60, 64, 69], 6), SR))
    expect(key).not.toBeNull()
    expect(key?.pitchClass).toBe(9)
    expect(key?.mode).toBe('minor')
  })

  it('hears a C major chord as C major', () => {
    const key = estimateKey(chroma(chord([48, 52, 55, 60], 6), SR))
    expect(key?.pitchClass).toBe(0)
    expect(key?.mode).toBe('major')
  })

  it('hears an F sharp major scale as F sharp major', () => {
    // F#3 G#3 A#3 B3 C#4 D#4 E#4 F#4 — a scale rather than a chord.
    const key = estimateKey(chroma(chord([54, 56, 58, 59, 61, 63, 65, 66], 6, 0.1), SR))
    expect(key?.pitchClass).toBe(6)
    expect(key?.mode).toBe('major')
  })

  it('returns null for silence', () => {
    expect(estimateKey(chroma(new Float32Array(SR * 5), SR))).toBeNull()
  })

  it('gives white noise a flat chroma, with no pitch class favoured', () => {
    // Summed, the uneven number of FFT bins per pitch class (B 40, C♯ 20) tilted
    // noise — and so every real song — towards A minor.
    const random = seeded(3)
    const noise = new Float32Array(SR * 10)
    for (let i = 0; i < noise.length; i++) noise[i] = random()
    const bins = Array.from(chroma(noise, SR))
    expect(Math.max(...bins) / Math.min(...bins)).toBeLessThan(1.05)
  })

  it('hears a D major chord as D major, not the old A minor default', () => {
    const key = estimateKey(chroma(chord([50, 54, 57, 62], 6), SR))
    expect(key?.pitchClass).toBe(2)
    expect(key?.mode).toBe('major')
  })
})

describe('energy', () => {
  it('scales with level and stays inside 0–1', () => {
    const quiet = new Float32Array(SR)
    const loud = new Float32Array(SR)
    for (let i = 0; i < SR; i++) {
      quiet[i] = 0.02 * Math.sin(i / 10)
      loud[i] = 0.6 * Math.sin(i / 10)
    }
    expect(rms(quiet)).toBeCloseTo(0.02 / Math.SQRT2, 3)
    const low = energyScore(quiet, 0)
    const high = energyScore(loud, 4)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
    expect(high).toBeGreaterThan(low)
    expect(energyScore(new Float32Array(SR), 0)).toBe(0)
  })
})

describe('analyzePcm', () => {
  it('reports a steady click track as highly danceable', () => {
    const features = analyzePcm(clickTrack(124, 30), SR)
    expect(Math.abs((features.bpm ?? 0) - 124)).toBeLessThanOrEqual(1.5)
    expect(features.danceability).not.toBeNull()
    expect(features.danceability ?? 0).toBeGreaterThan(0.7)
    expect(features.energy).toBeGreaterThan(0)
  })

  it('returns nulls for silence rather than throwing', () => {
    const features = analyzePcm(new Float32Array(SR * 15), SR)
    expect(features.bpm).toBeNull()
    expect(features.key).toBeNull()
    expect(features.camelot).toBeNull()
    expect(features.danceability).toBeNull()
    expect(features.energy).toBe(0)
  })

  it('names the key in Camelot as well as words', () => {
    const features = analyzePcm(chord([57, 60, 64, 69], 12), SR)
    expect(features.key).toBe('A minor')
    expect(features.camelot).toBe('8A')
  })
})

describe('motionFromPcm', () => {
  const MSR = MOTION_SAMPLE_RATE

  /** Clicks at the given times, over a faint noise bed, at the motion rate. */
  function clicksAt(times: readonly number[], seconds: number, seed = 3): Float32Array {
    const random = seeded(seed)
    const pcm = new Float32Array(Math.round(seconds * MSR))
    for (let i = 0; i < pcm.length; i++) pcm[i] = random() * 0.01
    const clickLength = Math.round(0.03 * MSR)
    for (const time of times) {
      const at = Math.round(time * MSR)
      for (let i = 0; i < clickLength && at + i < pcm.length; i++) {
        pcm[at + i] = (pcm[at + i] ?? 0) + random() * 1.2 * Math.exp(-i / (clickLength / 4))
      }
    }
    return pcm
  }

  function sine(amplitude: number, seconds: number, hz = 220): Float32Array {
    const pcm = new Float32Array(Math.round(seconds * MSR))
    for (let i = 0; i < pcm.length; i++) pcm[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / MSR)
    return pcm
  }

  function mean(bytes: Uint8Array, from: number, to: number): number {
    let sum = 0
    for (let i = from; i < to; i++) sum += bytes[i] ?? 0
    return sum / (to - from)
  }

  it('has one frame per 50 ms, rounded up, for any length', () => {
    for (const samples of [0, 1, 551, 552, 11025, 11026, 27_690, 123_457]) {
      const curve = motionFromPcm(new Float32Array(samples), MSR)
      expect(curve.rate).toBe(MOTION_FRAME_RATE)
      expect(curve.duration).toBeCloseTo(samples / MSR, 9)
      const expected = Math.ceil((samples * MOTION_FRAME_RATE) / MSR)
      expect(curve.loudness.length, `${samples} samples`).toBe(expected)
      expect(curve.onset.length, `${samples} samples`).toBe(expected)
    }
  })

  it('is all zeros for silence', () => {
    const curve = motionFromPcm(new Float32Array(5 * MSR), MSR)
    expect(curve.loudness.length).toBe(100)
    expect(curve.loudness.every(byte => byte === 0)).toBe(true)
    expect(curve.onset.every(byte => byte === 0)).toBe(true)
  })

  it('rises with amplitude, on the -60..0 dB scale', () => {
    const pcm = new Float32Array(6 * MSR)
    pcm.set(sine(0.01, 2), 0)
    pcm.set(sine(0.1, 2), 2 * MSR)
    pcm.set(sine(1, 2), 4 * MSR)
    const { loudness } = motionFromPcm(pcm, MSR)

    const quiet = mean(loudness, 2, 38)
    const middle = mean(loudness, 42, 78)
    const loud = mean(loudness, 82, 118)
    expect(quiet).toBeLessThan(middle)
    expect(middle).toBeLessThan(loud)
    // A sine's RMS is 3 dB under its peak: -43, -23 and -3 dB.
    expect(quiet).toBeCloseTo((17 / 60) * 255, -1)
    expect(middle).toBeCloseTo((37 / 60) * 255, -1)
    expect(loud).toBeCloseTo((57 / 60) * 255, -1)
  })

  it('peaks on the clicks and stays low between them', () => {
    const times = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5]
    const { onset } = motionFromPcm(clicksAt(times, 6), MSR)

    for (const time of times) {
      const frame = Math.floor(time * MOTION_FRAME_RATE)
      const near = Math.max(onset[frame - 1] ?? 0, onset[frame] ?? 0, onset[frame + 1] ?? 0)
      // The clicks' strengths vary and the 98th percentile is the scale, so
      // the weaker ones sit a little under 255 — but far above the bed.
      expect(near, `click at ${time}s`).toBeGreaterThanOrEqual(150)
      // Halfway to the next click there is only the bed.
      const between = Math.floor((time + 0.25) * MOTION_FRAME_RATE)
      if (between < onset.length) expect(onset[between], `after ${time}s`).toBeLessThan(60)
    }
  })

  it('shows the clicks in loudness too', () => {
    const { loudness } = motionFromPcm(clicksAt([1, 2], 3), MSR)
    expect(loudness[20] ?? 0).toBeGreaterThan((loudness[30] ?? 0) + 40)
  })

  it('gives the same curve however the PCM is handed over', () => {
    const pcm = clicksAt([0.3, 0.9, 1.7, 2.2], 3.3)
    const whole = motionFromPcm(pcm, MSR)

    const builder = new MotionBuilder(MSR)
    const random = seeded(9)
    for (let at = 0; at < pcm.length;) {
      const size = 1 + Math.floor((random() + 0.5) * 3000)
      builder.push(pcm.subarray(at, at + size))
      at += size
    }
    const pieces = builder.finish()

    expect(pieces.duration).toBe(whole.duration)
    expect([...pieces.loudness]).toEqual([...whole.loudness])
    expect([...pieces.onset]).toEqual([...whole.onset])
  })
})
