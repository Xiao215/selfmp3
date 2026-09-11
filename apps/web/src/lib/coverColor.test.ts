import { describe, expect, it } from 'vitest'
import { pickCoverColor, placeholderColor, rgbToOklch } from './coverColor.js'

/** RGBA pixels from a list of [r, g, b, count] runs. */
function pixels(...runs: Array<[number, number, number, number]>): Uint8ClampedArray {
  const out: number[] = []
  for (const [r, g, b, count] of runs) {
    for (let i = 0; i < count; i++) out.push(r, g, b, 255)
  }
  return new Uint8ClampedArray(out)
}

const hueOf = (css: string): number => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(css)?.[1])
const lightnessOf = (css: string): number => Number(/oklch\(([\d.]+)/.exec(css)?.[1])

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

describe('pickCoverColor', () => {
  it('finds the sky, not the dark skyline in front of it (THE BOOK covers)', () => {
    const orion = pickCoverColor(pixels([128, 150, 230, 400], [28, 26, 40, 200]))
    // Periwinkle blue, around 270° in OKLCH.
    expect(hueOf(orion!.color)).toBeGreaterThan(250)
    expect(hueOf(orion!.color)).toBeLessThan(290)
  })

  it('finds pink on a pink cover', () => {
    const gunjo = pickCoverColor(pixels([240, 149, 168, 500], [255, 255, 255, 60]))
    expect(hueOf(gunjo!.color)).toBeGreaterThan(0)
    expect(hueOf(gunjo!.color)).toBeLessThan(20)
  })

  it('lets the larger colour win when a cover has two', () => {
    // 夜に駆ける: mostly rose red, with a teal figure.
    const yoru = pickCoverColor(pixels([229, 86, 111, 420], [47, 143, 157, 140]))
    expect(hueOf(yoru!.color)).toBeLessThan(30)
  })

  it('gives up on a cover with no colour in it', () => {
    expect(
      pickCoverColor(pixels([20, 20, 20, 100], [128, 128, 128, 200], [250, 250, 250, 50])),
    ).toBeNull()
    expect(pickCoverColor(new Uint8ClampedArray())).toBeNull()
  })

  it('always gives light text and a mid-tone wash, however dark the cover', () => {
    const dark = pickCoverColor(pixels([60, 20, 90, 300]))!
    expect(lightnessOf(dark.tint)).toBeGreaterThan(0.8)
    expect(lightnessOf(dark.color)).toBeGreaterThan(0.6)
  })
})

describe('placeholderColor', () => {
  it('follows the placeholder cover’s golden-angle hue', () => {
    expect(hueOf(placeholderColor(1).color)).toBeCloseTo(137.5, 0)
    expect(hueOf(placeholderColor(2).color)).toBeCloseTo(275, 0)
  })
})
