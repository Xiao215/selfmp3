import { describe, expect, it } from 'vitest'
import { pickCoverTone, rgbToOklch } from '@selfmp3/shared'
import { songColors, tileTone, withAlpha } from './coverColor.js'

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

describe('tileTone', () => {
  it('follows the letter tile’s hue', () => {
    // hsl(0, 28%, 26%) is a muted brick red.
    const red = tileTone(0)
    expect(red.hue).toBeGreaterThan(0)
    expect(red.hue).toBeLessThan(40)
    expect(tileTone(220).hue).toBeGreaterThan(230)
  })
})

describe('withAlpha', () => {
  it('adds an alpha byte, replacing one already there', () => {
    expect(withAlpha('#336699', 0.5)).toBe('#33669980')
    expect(withAlpha('#336699ff', 0)).toBe('#33669900')
  })
})
