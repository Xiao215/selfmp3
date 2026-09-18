import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { oklchToHex } from './oklch.js'
import { buildAccent, colors, DEFAULT_ACCENT_HUE, tagColors } from './tokens.js'

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
    // 26% of the accent behind the tab pill and the mini player's wash, 40%
    // behind a selected row: the alpha byte is what React Native reads.
    const built = buildAccent(268)
    expect(built.accentWash).toBe(`${built.accent}42`)
    expect(built.accentPill).toMatch(/^#[0-9a-f]{6}42$/)
    expect(built.accentSelected).toMatch(/^#[0-9a-f]{6}66$/)
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

/**
 * Token parity: the hex in `tokens.ts` against the OKLCH in `tokens.reference.css`.
 *
 * The test above proves the arithmetic is the browser's. This one proves the
 * two files are still describing the same palette — that nobody has nudged
 * `--surface-2` in the stylesheet and left the phone a shade behind, which is
 * exactly the drift that would otherwise be found by eye, months later, on a
 * screenshot comparison.
 *
 * It reads the stylesheet rather than restating it. A copied list of expected
 * values would go stale in the same way and for the same reason.
 */
describe('token parity with the web stylesheet', () => {
  const CSS = readFileSync(new URL('./tokens.reference.css', import.meta.url), 'utf8')

  /** `--name: oklch(L C H)`, where H is a number or `var(--accent-hue)`. */
  function cssToken(name: string): { l: number; c: number; h: number } {
    const match = new RegExp(
      `--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+(var\\(--accent-hue\\)|[\\d.]+)\\)`,
    ).exec(CSS)
    if (!match) throw new Error(`--${name} is not an oklch() token in tokens.css`)
    const [, l, c, h] = match
    return {
      l: Number(l),
      c: Number(c),
      h: h === 'var(--accent-hue)' ? DEFAULT_ACCENT_HUE : Number(h),
    }
  }

  it('starts from the hue the stylesheet starts from', () => {
    const match = /--accent-hue:\s*([\d.]+)/.exec(CSS)
    expect(Number(match?.[1])).toBe(DEFAULT_ACCENT_HUE)
  })

  it.each([
    ['surface-0', 'surface0'],
    ['surface-1', 'surface1'],
    ['surface-2', 'surface2'],
    ['surface-3', 'surface3'],
    ['surface-selected', 'surfaceSelected'],
    ['text-primary', 'textPrimary'],
    ['text-secondary', 'textSecondary'],
    ['text-muted', 'textMuted'],
    ['accent', 'accent'],
    ['accent-strong', 'accentStrong'],
    ['accent-dim', 'accentDim'],
    ['on-accent', 'onAccent'],
    ['danger', 'danger'],
    ['warning', 'warning'],
    ['good', 'good'],
    ['border', 'border'],
    ['border-strong', 'borderStrong'],
    ['chart-grid', 'chartGrid'],
    // In the accent's hue, so the charts follow the accent picker.
    ['chart-series', 'chartSeries'],
  ] as const)('--%s is %s', (cssName, key) => {
    const { l, c, h } = cssToken(cssName)
    expect(colors[key]).toBe(oklchToHex(l, c, h))
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

  it('gives two hues two different tiles', () => {
    expect(tagColors(20, 'dark').tile).not.toBe(tagColors(150, 'dark').tile)
  })
})
