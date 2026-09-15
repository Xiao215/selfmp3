import { describe, expect, it } from 'vitest'
import { MOTION_VERSION, type Motion } from '@selfmp3/shared'
import { base64ToBytes, decodeMotion, sampleMotion, type MotionCurve } from './motion.js'

/** The server writes the curve with Node's own base64; the decoder must agree with it. */
const encode = (bytes: readonly number[]): string => Buffer.from(bytes).toString('base64')

const curve = (loudness: readonly number[], onset: readonly number[], rate = 20): MotionCurve => ({
  rate,
  duration: loudness.length / rate,
  loudness: Uint8Array.from(loudness),
  onset: Uint8Array.from(onset),
})

describe('decodeMotion', () => {
  it('gives back exactly the bytes the server encoded, at every padding length', () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return Math.floor((seed / 4294967296) * 256)
    }
    for (let length = 0; length < 40; length++) {
      const loudness = Array.from({ length }, random)
      const onset = Array.from({ length }, random)
      const motion: Motion = {
        version: MOTION_VERSION,
        rate: 20,
        duration: length / 20,
        loudness: encode(loudness),
        onset: encode(onset),
      }
      const decoded = decodeMotion(motion)
      expect([...decoded.loudness]).toEqual(loudness)
      expect([...decoded.onset]).toEqual(onset)
      expect(decoded.rate).toBe(20)
      expect(decoded.duration).toBe(length / 20)
    }
  })

  it('covers every byte value', () => {
    const all = Array.from({ length: 256 }, (_, i) => i)
    expect([...base64ToBytes(encode(all))]).toEqual(all)
  })

  it('reads URL-safe base64 and ignores line breaks', () => {
    const bytes = [251, 255, 191, 0, 62]
    const urlSafe = encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect([...base64ToBytes(urlSafe)]).toEqual(bytes)
    expect([...base64ToBytes(`${encode(bytes).slice(0, 4)}\n${encode(bytes).slice(4)}`)]).toEqual(
      bytes,
    )
  })
})

describe('sampleMotion', () => {
  it('reads a frame on its own time', () => {
    const c = curve([0, 255, 51], [255, 0, 102])
    expect(sampleMotion(c, 0)).toEqual({ level: 0, onset: 1 })
    expect(sampleMotion(c, 0.05)).toEqual({ level: 1, onset: 0 })
    expect(sampleMotion(c, 0.1)).toEqual({ level: 0.2, onset: 0.4 })
  })

  it('interpolates between frames', () => {
    const c = curve([0, 255], [100, 200])
    const quarter = sampleMotion(c, 0.0125)
    expect(quarter.level).toBeCloseTo(0.25, 6)
    expect(quarter.onset).toBeCloseTo(125 / 255, 6)
    expect(sampleMotion(c, 0.025).level).toBeCloseTo(0.5, 6)
  })

  it('holds the last frame through its own 50 ms, then is 0 past the end', () => {
    const c = curve([10, 255], [0, 255])
    expect(sampleMotion(c, 0.07)).toEqual({ level: 1, onset: 1 })
    expect(sampleMotion(c, 0.1)).toEqual({ level: 0, onset: 0 })
    expect(sampleMotion(c, 600)).toEqual({ level: 0, onset: 0 })
  })

  it('reads the first frame before the start', () => {
    expect(sampleMotion(curve([51], [102]), -3)).toEqual({ level: 0.2, onset: 0.4 })
  })

  it('is 0 for an empty curve, and for a time that is not a number', () => {
    expect(sampleMotion(curve([], []), 0)).toEqual({ level: 0, onset: 0 })
    expect(sampleMotion(curve([], []), 12)).toEqual({ level: 0, onset: 0 })
    expect(sampleMotion(curve([200], [200]), Number.NaN)).toEqual({ level: 0, onset: 0 })
  })
})
