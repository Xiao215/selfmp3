import { describe, expect, it } from 'vitest'
import { NATIVE_ACCENT } from '@selfmp3/shared'
import { withAlpha } from '../art/coverColor.js'
import { oklchToHex, oklchToHexAlpha } from './oklch.js'
import {
  buildAccent,
  colors,
  darkPalette,
  DEFAULT_ACCENT_HUE,
  hitSlopFor,
  leading,
  lightPalette,
  tagColors,
  type,
} from './tokens.js'

/**
 * The phone's arithmetic against the browser's.
 *
 * Every expected value below was read out of Chrome: each `oklch(...)` painted
 * onto a 1×1 canvas and the pixel read back, which is the browser doing the
 * conversion the client relies on. If this file ever disagrees, the two
 * platforms have started drawing different colours from the same setting.
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
      expect(buildAccent(hue), `hue ${hue}`).toMatchObject({
        accent,
        accentStrong,
        accentDim,
        onAccent,
      })
    }
  })

  it('carries the tints the web draws with an alpha as #rrggbbaa', () => {
    // 26% of the accent behind the tab pill and the mini player's wash, 28%
    // behind a selected row: the alpha byte is what React Native reads.
    const built = buildAccent(268)
    expect(built.accentWash).toBe(`${built.accent}42`)
    expect(built.accentPill).toMatch(/^#[0-9a-f]{6}42$/)
    expect(built.accentSelected).toMatch(/^#[0-9a-f]{6}47$/)
  })

  it('washes a song or the accent at one strength per theme', () => {
    expect(buildAccent(268, 'dark').washAlpha).toBe(0.26)
    expect(buildAccent(268, 'light').washAlpha).toBe(0.18)
    // The light accent's wash is drawn at it too: 18% is the byte 0x2e.
    expect(buildAccent(268, 'light').accentWash).toBe(`${buildAccent(268, 'light').accent}2e`)
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

describe('the type scale', () => {
  it('has nine sizes, each with a line height, and no half points', () => {
    expect(Object.values(type)).toEqual([11, 12, 13, 15, 17, 18, 22, 30, 46])
    for (const step of Object.keys(type) as (keyof typeof type)[]) {
      expect(leading[step], step).toBeGreaterThan(type[step])
    }
  })
})

describe('a tag, from its hue', () => {
  // S2: tile oklch(0.32 0.07 h), ink oklch(0.85 0.10 h), dot oklch(0.80 0.12 h).
  it.each([20, 150, 268])('draws hue %i as S2 writes it', hue => {
    expect(tagColors(hue, 'dark')).toMatchObject({
      tile: oklchToHex(0.32, 0.07, hue),
      tileInk: oklchToHex(0.85, 0.1, hue),
      dot: oklchToHex(0.8, 0.12, hue),
    })
  })

  it('ticks a swatch in the darker of the tile’s two colours', () => {
    expect(tagColors(150, 'dark').onDot).toBe(tagColors(150, 'dark').tile)
    expect(tagColors(150, 'light').onDot).toBe(tagColors(150, 'light').tileInk)
  })

  it('gives two hues two different tiles', () => {
    expect(tagColors(20, 'dark').tile).not.toBe(tagColors(150, 'dark').tile)
  })
})

describe('the dim behind a dialog', () => {
  // One value everywhere: dialogs and sheets once used three slightly different ones.
  it('is the accent-tinted near-black at 0.6, in both themes', () => {
    expect(darkPalette(150).backdrop).toBe(oklchToHexAlpha(0.1, 0.02, 150, 0.6))
    expect(lightPalette(150).backdrop).toBe(darkPalette(150).backdrop)
  })
})

describe('the washes and the veil', () => {
  // Written as an alpha at each site they drifted: a danger wash at 0.12 and
  // 0.14, a good one at 0.14 and 0.18, a veil at 0.07, 0.08 and 0.1.
  it.each([
    ['dark', darkPalette(150)],
    ['light', lightPalette(150)],
  ] as const)("are the %s palette's own inks at one strength each", (_scheme, palette) => {
    expect(palette.veil).toBe(withAlpha(palette.textPrimary, 0.08))
    expect(palette.veilPressed).toBe(withAlpha(palette.textPrimary, 0.14))
    expect(palette.dangerWash).toBe(withAlpha(palette.danger, 0.14))
    expect(palette.goodWash).toBe(withAlpha(palette.good, 0.14))
    expect(palette.warningWash).toBe(withAlpha(palette.warning, 0.14))
  })
})

describe('the widget', () => {
  // Its Xcode target is coloured at prebuild time from @selfmp3/shared.
  it('is tinted with the accent the app starts on', () => {
    expect(buildAccent(DEFAULT_ACCENT_HUE, 'dark').accent).toBe(NATIVE_ACCENT)
  })
})

describe('hitSlopFor', () => {
  it('pads a small target out to the 44-point minimum, and a big one not at all', () => {
    expect(hitSlopFor(28)).toBe(8)
    expect(hitSlopFor(20)).toBe(12)
    expect(hitSlopFor(44)).toBe(0)
    expect(hitSlopFor(56)).toBe(0)
  })
})
