import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'
import { oklchToHex } from './oklch.js'
import {
  applyColorScheme,
  buildAccent,
  colors,
  currentColorScheme,
  DEFAULT_ACCENT_HUE,
  lightPalette,
  tagColors,
} from './tokens.js'

/**
 * The light theme against `tokens.reference.css`'s `:root[data-theme='light']`,
 * read from the stylesheet as the dark theme's parity test reads `:root`.
 */

const CSS = readFileSync(new URL('./tokens.reference.css', import.meta.url), 'utf8')
const LIGHT = (() => {
  const start = CSS.indexOf(":root[data-theme='light'] {")
  return CSS.slice(start, CSS.indexOf('}', start))
})()

function lightToken(name: string): string {
  // Paper's greys are written as hex: they are fixed, not worked out from the hue.
  const hex = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(LIGHT)
  if (hex) return hex[1]!
  const match = new RegExp(
    `--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+(var\\(--accent-hue\\)|[\\d.]+)\\)`,
  ).exec(LIGHT)
  if (!match) throw new Error(`--${name} is not an oklch() token in the light block`)
  const [, l, c, h] = match
  return oklchToHex(
    Number(l),
    Number(c),
    h === 'var(--accent-hue)' ? DEFAULT_ACCENT_HUE : Number(h),
  )
}

afterEach(() => applyColorScheme('dark'))

describe('the light theme', () => {
  it('--chart-series is chartSeries, in the accent hue', () => {
    expect(lightPalette(DEFAULT_ACCENT_HUE).chartSeries).toBe(lightToken('chart-series'))
    // A green accent draws green bars, not the blue the charts were written in.
    expect(lightPalette(150).chartSeries).not.toBe(lightPalette(DEFAULT_ACCENT_HUE).chartSeries)
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
    ['border', 'border'],
    ['border-strong', 'borderStrong'],
    ['chart-grid', 'chartGrid'],
  ] as const)('--%s is %s', (cssName, key) => {
    expect(lightPalette(DEFAULT_ACCENT_HUE)[key]).toBe(lightToken(cssName))
  })

  it('fills the palette for a theme, and puts the dark one back', () => {
    applyColorScheme('light', DEFAULT_ACCENT_HUE)
    expect(currentColorScheme()).toBe('light')
    expect(colors.surface0).toBe(lightToken('surface-0'))
    expect(buildAccent(DEFAULT_ACCENT_HUE).accent).toBe(lightToken('accent'))

    applyColorScheme('dark')
    expect(colors.surface0).toBe('#0b0d13')
    expect(colors.accent).toBe('#7a9eff')
    expect(buildAccent(DEFAULT_ACCENT_HUE).accent).toBe('#7a9eff')
  })

  it('turns a tag round so its ink still reads', () => {
    // Dark: a deep tile with light ink. Paper: a pale tint with dark ink.
    const dark = tagColors(150, 'dark')
    const light = tagColors(150, 'light')
    expect(light.tileInk).not.toBe(dark.tileInk)
    expect(luminance(light.tile)).toBeGreaterThan(luminance(light.tileInk))
    expect(luminance(dark.tile)).toBeLessThan(luminance(dark.tileInk))
    applyColorScheme('light')
    expect(tagColors(150)).toEqual(light)
  })

  it('does not tint Paper by the accent hue', () => {
    expect(lightPalette(150).surface0).toBe(lightPalette(DEFAULT_ACCENT_HUE).surface0)
    expect(lightPalette(150).accent).not.toBe(lightPalette(DEFAULT_ACCENT_HUE).accent)
  })
})

/** Rough relative lightness of a hex colour, enough to say which of two is lighter. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16)
  return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722
}
