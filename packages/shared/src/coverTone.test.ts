import { describe, expect, it } from 'vitest'
import { hasColour, pickCoverTone, rgbToOklch } from './coverTone.js'

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

  it('finds a colour on a cover whose colour is spread over several hues (祝福)', () => {
    // Muted greens, teals and blues in about equal parts, none a big share alone.
    const shukufuku = pickCoverTone(
      pixels(
        [96, 128, 84, 110],
        [84, 124, 118, 110],
        [88, 108, 142, 110],
        [124, 126, 86, 110],
        [104, 96, 132, 110],
        [12, 14, 12, 26],
      ),
    )
    expect(shukufuku).not.toBeNull()
  })

  it('finds the soft colour of square art letterboxed on black (千鳥, as a video still)', () => {
    // Beige paper, a small drawing, and black bars over a third of the frame.
    const plover = pickCoverTone(pixels([214, 196, 168, 400], [60, 48, 40, 40], [0, 0, 0, 240]))
    expect(plover).not.toBeNull()
    // A warm yellow-orange, in OKLCH.
    expect(plover?.hue).toBeGreaterThan(50)
    expect(plover?.hue).toBeLessThan(100)
  })

  it('keeps a soft colour when all of it is one colour, but not grey with noise', () => {
    // Pale beige paper: below the usual bar for colour, but one hue throughout.
    const paper = pixels([222, 214, 202, 500], [40, 36, 34, 40])
    expect(rgbToOklch(222, 214, 202).c).toBeLessThan(0.02)
    expect(pickCoverTone(paper)?.hue).toBeGreaterThan(40)
    // The same little colour spread over every hue is a grey collage (Plagiarism).
    const collage = pickCoverTone(
      pixels(
        [140, 132, 130, 100],
        [130, 138, 132, 100],
        [130, 132, 142, 100],
        [138, 130, 138, 100],
      ),
    )
    expect(collage?.chroma).toBe(0)
    expect(hasColour(collage!)).toBe(false)
  })

  it('calls a cover with no colour in it grey, and says how light it is', () => {
    // A black-and-white photograph: dark, mid and pale greys.
    const photo = pickCoverTone(
      pixels([20, 20, 20, 100], [128, 128, 128, 200], [250, 250, 250, 50]),
    )
    expect(photo?.chroma).toBe(0)
    expect(hasColour(photo!)).toBe(false)
    // Its palette carries the lightness the screen draws its grey at.
    const lightness = (photo?.palette ?? []).reduce((sum, s) => sum + s.l * s.share, 0)
    expect(lightness).toBeGreaterThan(0.4)
    expect(lightness).toBeLessThan(0.7)
    // Pure black is grey too, not nothing.
    expect(pickCoverTone(pixels([0, 0, 0, 50]))?.chroma).toBe(0)
  })

  it('gives up only on a cover with nothing to read', () => {
    expect(pickCoverTone(new Uint8ClampedArray())).toBeNull()
    // Every pixel transparent: nothing was drawn.
    expect(pickCoverTone(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0]))).toBeNull()
  })
})
