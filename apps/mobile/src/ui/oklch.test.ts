import { describe, expect, it } from 'vitest'
import { oklchToHex } from './oklch'
import { buildAccent, colors, DEFAULT_ACCENT_HUE } from './theme'

/**
 * The phone's arithmetic against the browser's.
 *
 * Every expected value below was read out of Chrome: each `oklch(...)` painted
 * onto a 1×1 canvas and the pixel read back, which is the browser doing the
 * conversion the web app relies on. If this file ever disagrees, the two apps
 * have started drawing different colours from the same setting.
 */

const ACCENT = [
  [268, '#7a9eff', '#86afff', '#364983', '#080b14'],
  [220, '#00bae9', '#00cfff', '#005872', '#030d11'],
  [190, '#00c3bb', '#00dad1', '#005d59', '#020e0d'],
  [150, '#4ac06c', '#4cd676', '#195c2e', '#060e07'],
  [60, '#eb881f', '#ff9710', '#733d00', '#110904'],
  [20, '#f8767a', '#ff8187', '#7a3336', '#130808'],
  [330, '#db7cd4', '#f689ed', '#6b3767', '#10080f'],
] as const

describe('oklchToHex', () => {
  it('matches the browser at every accent the picker offers', () => {
    for (const [hue, accent, accentStrong, accentDim, onAccent] of ACCENT) {
      expect(buildAccent(hue), `hue ${hue}`).toEqual({
        accent,
        accentStrong,
        accentDim,
        onAccent,
      })
    }
  })

  it('leaves the palette exactly where it was written by hand', () => {
    // These four were hand-derived at hue 268 before any of this existed;
    // computing them has to land on the same values or the app changes colour.
    expect(colors.accent).toBe('#7a9eff')
    expect(colors.accentStrong).toBe('#86afff')
    expect(colors.accentDim).toBe('#364983')
    expect(colors.onAccent).toBe('#080b14')
    expect(DEFAULT_ACCENT_HUE).toBe(268)
  })

  it('wraps the hue the way an angle does', () => {
    expect(oklchToHex(0.72, 0.16, 0)).toBe(oklchToHex(0.72, 0.16, 360))
    expect(oklchToHex(0.72, 0.16, -90)).toBe(oklchToHex(0.72, 0.16, 270))
  })

  it('clips a colour sRGB cannot show rather than wrapping it', () => {
    // Chroma far past the gamut: every channel still lands inside 00–ff.
    const hex = oklchToHex(0.72, 0.9, 150)
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('gives black and white at the ends', () => {
    expect(oklchToHex(0, 0, 0)).toBe('#000000')
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff')
  })
})
