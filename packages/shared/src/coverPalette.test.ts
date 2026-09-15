import { describe, expect, it } from 'vitest'
import { pickCoverPalette, pickCoverTone } from './coverTone.js'

/** RGBA pixels from a list of [r, g, b, count] runs. */
function pixels(...runs: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out: number[] = []
  for (const [r, g, b, count] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(out)
}

const hueDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180)

/** A Genshin-like cover: green grass, a pink-lilac sky, blue water, a dark shade. */
const landscape = pixels(
  [96, 170, 70, 170],
  [214, 176, 214, 150],
  [92, 138, 214, 120],
  [30, 44, 40, 60],
)

describe('pickCoverPalette', () => {
  it('keeps the colours a cover is made of, not only the most vivid one', () => {
    const palette = pickCoverPalette(landscape)
    const hues = palette.filter(swatch => swatch.c >= 0.03).map(swatch => swatch.h)
    // Green (~140°), pink-lilac (~320°) and blue (~260°) are all there.
    expect(hues.some(h => hueDistance(h, 140) < 25)).toBe(true)
    expect(hues.some(h => hueDistance(h, 320) < 30)).toBe(true)
    expect(hues.some(h => hueDistance(h, 262) < 25)).toBe(true)
  })

  it('keeps the dark colour too, for the ground', () => {
    const palette = pickCoverPalette(landscape)
    expect(Math.min(...palette.map(swatch => swatch.l))).toBeLessThan(0.35)
  })

  it('puts the most of the cover first, and shares add up to the whole', () => {
    const palette = pickCoverPalette(landscape)
    for (let i = 1; i < palette.length; i++) {
      expect(palette[i - 1]!.share).toBeGreaterThanOrEqual(palette[i]!.share)
    }
    const total = palette.reduce((sum, swatch) => sum + swatch.share, 0)
    expect(total).toBeGreaterThan(0.95)
    expect(total).toBeLessThanOrEqual(1.01)
  })

  it('gives the same palette for the same cover every time', () => {
    expect(pickCoverPalette(landscape)).toEqual(pickCoverPalette(landscape))
  })

  it('leaves out a speck that is not really part of the cover', () => {
    const palette = pickCoverPalette(pixels([240, 149, 168, 600], [30, 200, 60, 4]))
    expect(palette.every(swatch => swatch.share >= 0.02)).toBe(true)
  })

  it('is empty for a cover with no opaque pixels', () => {
    expect(pickCoverPalette(new Uint8ClampedArray([10, 20, 30, 0]))).toEqual([])
  })

  it('travels with the cover tone', () => {
    const tone = pickCoverTone(landscape)
    expect(tone?.palette?.length).toBeGreaterThan(2)
  })
})
