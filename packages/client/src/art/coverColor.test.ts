import { describe, expect, it } from 'vitest'
import { pickCoverTone, rgbToOklch } from '@selfmp3/shared'
import { neutralWash, songColors, tileTone, withAlpha } from './coverColor.js'

/** RGBA pixels of one colour. */
const solid = (r: number, g: number, b: number): number[] =>
  Array.from({ length: 300 }, () => [r, g, b, 255]).flat()

const lightnessOf = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
  return rgbToOklch(r ?? 0, g ?? 0, b ?? 0).l
}

describe('songColors', () => {
  it('always gives light text and a mid-tone wash on the dark theme, however dark the cover', () => {
    const dark = songColors(pickCoverTone(solid(60, 20, 90))!, 'dark')
    expect(lightnessOf(dark.tint)).toBeGreaterThan(0.8)
    expect(lightnessOf(dark.color)).toBeGreaterThan(0.6)
  })

  it('gives dark text on the light theme, however pale the cover', () => {
    const pale = songColors(pickCoverTone(solid(200, 230, 250))!, 'light')
    expect(lightnessOf(pale.tint)).toBeLessThan(0.5)
  })
})

describe('neutralWash', () => {
  it('is a grey as light as the cover, lifted on the dark theme and lowered on the light', () => {
    const pale = pickCoverTone(solid(235, 235, 235))!
    const dark = pickCoverTone(solid(40, 40, 40))!
    expect(pale.chroma).toBe(0)
    const chromaOf = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
      return rgbToOklch(r ?? 0, g ?? 0, b ?? 0).c
    }
    expect(chromaOf(neutralWash(pale, 'dark'))).toBeLessThan(0.01)
    expect(lightnessOf(neutralWash(pale, 'dark'))).toBeGreaterThan(
      lightnessOf(neutralWash(dark, 'dark')),
    )
    expect(lightnessOf(neutralWash(pale, 'dark'))).toBeGreaterThan(0.85)
    expect(lightnessOf(neutralWash(dark, 'dark'))).toBeGreaterThan(0.55)
    expect(lightnessOf(neutralWash(pale, 'light'))).toBeLessThan(
      lightnessOf(neutralWash(pale, 'dark')),
    )
  })
})

describe('tileTone', () => {
  it('is the tone of the letter tile, a tag tile in that hue', () => {
    for (const scheme of ['dark', 'light'] as const) {
      // Read back from the tile's hex, so a few degrees off the hue it was made at.
      expect(Math.abs(tileTone(220, scheme).hue - 220), scheme).toBeLessThan(8)
    }
    // Deep in the dark, pale on Paper: the light tile carries less colour.
    expect(tileTone(0, 'dark').chroma).toBeCloseTo(0.07, 2)
    expect(tileTone(0, 'light').chroma).toBeCloseTo(0.045, 2)
  })
})

describe('withAlpha', () => {
  it('adds an alpha byte, replacing one already there', () => {
    expect(withAlpha('#336699', 0.5)).toBe('#33669980')
    expect(withAlpha('#336699ff', 0)).toBe('#33669900')
  })

  it('spells out a shorthand hex before adding the byte', () => {
    expect(withAlpha('#abc', 0.5)).toBe('#aabbcc80')
    expect(withAlpha('#abcd', 0.5)).toBe('#aabbcc80')
  })

  // A browser's Unistyles stylesheet sees `var(--colors-x)`, not a hex: an
  // alpha byte sliced onto that broke the whole stylesheet after it.
  it('mixes a CSS variable with transparency rather than slicing it', () => {
    expect(withAlpha('var(--colors-text-primary)', 0.1)).toBe(
      'color-mix(in srgb, var(--colors-text-primary) 10%, transparent)',
    )
    expect(withAlpha('var(--colors-danger)', 0.12)).toBe(
      'color-mix(in srgb, var(--colors-danger) 12%, transparent)',
    )
  })
})
