import { describe, expect, it } from 'vitest'
import {
  chunks,
  dot,
  encoderFrames,
  fromBlob,
  normaliseClip,
  SOUND_DIMENSIONS,
  SOUND_SAMPLE_RATE,
  toBlob,
  unit,
  windowStarts,
} from './vectors.js'

describe('windowStarts', () => {
  it('hears three windows, a fifth, under half and seven tenths of the way in', () => {
    expect(windowStarts(200)).toEqual([40, 90, 140])
  })

  it('keeps the last window inside the song', () => {
    expect(windowStarts(31)).toEqual([6.2, 13.95, 21])
  })

  it('hears a song no longer than the three windows whole, once', () => {
    expect(windowStarts(30)).toEqual([0])
    expect(windowStarts(8)).toEqual([0])
    expect(windowStarts(Number.NaN)).toEqual([0])
  })
})

describe('normaliseClip', () => {
  it('gives the clip zero mean and unit variance, as Wav2Vec2 does', () => {
    const clip = Float32Array.from({ length: 1000 }, (_, i) => 0.3 + 0.1 * Math.sin(i / 7))
    const out = normaliseClip(clip)
    const mean = out.reduce((a, b) => a + b, 0) / out.length
    const variance = out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length
    expect(mean).toBeCloseTo(0, 5)
    expect(variance).toBeCloseTo(1, 3)
  })

  it('leaves silence silent rather than dividing by nothing', () => {
    expect([...normaliseClip(new Float32Array(10))]).toEqual(new Array(10).fill(0))
  })
})

describe('chunks', () => {
  it('cuts the clip into 5 s pieces and drops a last one under a second', () => {
    const clip = new Float32Array(SOUND_SAMPLE_RATE * 10.5)
    expect(chunks(clip).map(chunk => chunk.length / SOUND_SAMPLE_RATE)).toEqual([5, 5])
    const longer = new Float32Array(SOUND_SAMPLE_RATE * 11.5)
    expect(chunks(longer).map(chunk => chunk.length / SOUND_SAMPLE_RATE)).toEqual([5, 5, 1.5])
  })
})

describe('encoderFrames', () => {
  it('puts each chunk between two zero frames', () => {
    const a = new Float32Array(SOUND_DIMENSIONS).fill(1)
    const b = new Float32Array(SOUND_DIMENSIONS).fill(2)
    const { data, frames } = encoderFrames([a, b])
    expect(frames).toBe(4)
    expect(data.subarray(0, SOUND_DIMENSIONS).every(v => v === 0)).toBe(true)
    expect(data[SOUND_DIMENSIONS]).toBe(1)
    expect(data[2 * SOUND_DIMENSIONS]).toBe(2)
    expect(data.subarray(3 * SOUND_DIMENSIONS).every(v => v === 0)).toBe(true)
  })
})

describe('vectors', () => {
  it('compares unit vectors by their dot product', () => {
    const a = unit([3, 4])
    expect(Math.hypot(...a)).toBeCloseTo(1, 6)
    expect(dot(a, unit([3, 4]))).toBeCloseTo(1, 6)
    expect(dot(unit([1, 0]), unit([0, 1]))).toBe(0)
  })

  it('keeps a vector as SQLite bytes and reads it back', () => {
    const vector = unit(Array.from({ length: SOUND_DIMENSIONS }, (_, i) => Math.sin(i)))
    expect(fromBlob(toBlob(vector))).toEqual(vector)
    expect(fromBlob(Buffer.alloc(12))).toBeNull()
    expect(fromBlob(null)).toBeNull()
  })
})
