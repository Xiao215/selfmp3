import { describe, expect, it } from 'vitest'
import { pickCoverTone, rgbToOklch } from './coverTone.js'

/** RGBA pixels from a list of [r, g, b, count] runs. */
function pixels(...runs: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out: number[] = []
  for (const [r, g, b, count] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(out)
}

describe('rgbToOklch', () => {
  it('matches the reference values for white, black and pure red', () => {
    expect(rgbToOklch(255, 255, 255).l).toBeCloseTo(1, 3)
    expect(rgbToOklch(0, 0, 0).l).toBeCloseTo(0, 3)
    const red = rgbToOklch(255, 0, 0)
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.c).toBeCloseTo(0.258, 2)
    expect(red.h).toBeCloseTo(29.2, 0)
  })
})

describe('pickCoverTone', () => {
  it('finds the sky, not the dark skyline in front of it (THE BOOK covers)', () => {
    const orion = pickCoverTone(pixels([128, 150, 230, 400], [28, 26, 40, 200]))
    // Periwinkle blue, around 270° in OKLCH.
    expect(orion?.hue).toBeGreaterThan(250)
    expect(orion?.hue).toBeLessThan(290)
  })

  it('finds pink on a pink cover', () => {
    const gunjo = pickCoverTone(pixels([240, 149, 168, 500], [255, 255, 255, 60]))
    expect(gunjo?.hue).toBeGreaterThan(0)
    expect(gunjo?.hue).toBeLessThan(20)
  })

  it('lets the larger colour win when a cover has two', () => {
    // 夜に駆ける: mostly rose red, with a teal figure.
    const yoru = pickCoverTone(pixels([229, 86, 111, 420], [47, 143, 157, 140]))
    expect(yoru?.hue).toBeLessThan(30)
  })

  it('gives up on a cover with no colour in it', () => {
    expect(
      pickCoverTone(pixels([20, 20, 20, 100], [128, 128, 128, 200], [250, 250, 250, 50])),
    ).toBeNull()
    expect(pickCoverTone(new Uint8ClampedArray())).toBeNull()
  })
})
