import { describe, expect, it } from 'vitest'
import type { SongFeatures } from '@selfmp3/shared'
import { autoVisual, paletteFromPixels, placeholderPalette } from './visuals.js'

const features = (energy: number | null): SongFeatures => ({
  bpm: 120,
  energy,
  loudnessLufs: -10,
  key: null,
  camelot: null,
  danceability: 0.5,
  analyzedAt: '2026-01-01T00:00:00Z',
  version: 1,
})

describe('autoVisual', () => {
  it('gives calm songs, and songs not analysed yet, the aurora', () => {
    expect(autoVisual(features(0.16), true)).toBe('aurora')
    expect(autoVisual(features(null), true)).toBe('aurora')
    expect(autoVisual(null, true)).toBe('aurora')
  })

  it('gives a song with a beat the pulse', () => {
    expect(autoVisual(features(0.5), true)).toBe('pulse')
    expect(autoVisual(features(0.35), false)).toBe('pulse')
  })

  it('gives a busy song the live spectrum only where the music can be heard', () => {
    expect(autoVisual(features(0.9), true)).toBe('ring')
    expect(autoVisual(features(0.9), false)).toBe('pulse')
  })
})

/** A flat RGBA buffer from a list of [r, g, b, count]. */
function pixels(...runs: [number, number, number, number][]): number[] {
  const out: number[] = []
  for (const [r, g, b, count] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, 255)
  }
  return out
}

describe('paletteFromPixels', () => {
  it('returns null for an empty or fully transparent image', () => {
    expect(paletteFromPixels([])).toBeNull()
    expect(paletteFromPixels([10, 10, 10, 0])).toBeNull()
  })

  it('lets a colourful minority win over a larger grey area', () => {
    const palette = paletteFromPixels(pixels([128, 128, 128, 60], [230, 40, 40, 30]))
    const [r, g, b] = palette![0]
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('makes the third colour dark enough to be a ground', () => {
    const palette = paletteFromPixels(pixels([240, 150, 170, 50], [140, 120, 240, 40]))
    const [r, g, b] = palette![2]
    expect(Math.max(r, g, b)).toBeLessThan(140)
  })

  it('still returns something for a black-and-white cover', () => {
    expect(paletteFromPixels(pixels([0, 0, 0, 40], [255, 255, 255, 40]))).not.toBeNull()
  })
})

describe('placeholderPalette', () => {
  it('is stable for a song id', () => {
    expect(placeholderPalette(7)).toEqual(placeholderPalette(7))
    expect(placeholderPalette(7)).not.toEqual(placeholderPalette(8))
  })
})
