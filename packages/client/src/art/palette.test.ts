import { describe, expect, it } from 'vitest'

import { paletteFromPixels, placeholderPalette, rgba, type Rgb } from './palette.js'

/** A thumbnail made of runs of one colour: `[colour, pixel count]`. */
function pixels(...runs: [Rgb, number][]): number[] {
  return runs.flatMap(([[r, g, b], count]) =>
    Array.from({ length: count }, () => [r, g, b, 255]).flat(),
  )
}

const hueOf = ([r, g, b]: Rgb): number => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  if (max === r) return (((g - b) / d + 6) % 6) * 60
  if (max === g) return ((b - r) / d + 2) * 60
  return ((r - g) / d + 4) * 60
}

describe('cover palette', () => {
  it('has nothing to say about an empty or transparent thumbnail', () => {
    expect(paletteFromPixels([])).toBeNull()
    expect(paletteFromPixels([255, 0, 0, 0])).toBeNull()
  })

  it('lets a small colourful part win over a large grey one', () => {
    const palette = paletteFromPixels(pixels([[128, 128, 128], 400], [[220, 30, 30], 60]))
    expect(palette).not.toBeNull()
    const [first] = palette ?? []
    expect(first && hueOf(first)).toBeLessThan(15)
  })

  it('keeps the glow light and the ground dark, whatever the cover', () => {
    for (const cover of [pixels([[10, 10, 40], 100]), pixels([[250, 240, 200], 100])]) {
      const [first, , ground] = paletteFromPixels(cover) ?? []
      const lightness = (c: Rgb): number => (Math.max(...c) + Math.min(...c)) / 2 / 255
      expect(first && lightness(first)).toBeGreaterThanOrEqual(0.49)
      expect(ground && lightness(ground)).toBeLessThanOrEqual(0.21)
    }
  })

  it('gives each song a steady placeholder of its own', () => {
    expect(placeholderPalette(7)).toEqual(placeholderPalette(7))
    expect(placeholderPalette(7)).not.toEqual(placeholderPalette(8))
  })

  it('writes a colour for a style', () => {
    expect(rgba([10.4, 20.6, 30], 0.5)).toBe('rgba(10, 21, 30, 0.5)')
  })
})
