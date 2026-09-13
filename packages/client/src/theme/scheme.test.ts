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
 * The light theme against the web's `:root[data-theme='light']`, read from the
 * stylesheet as the dark theme's parity test reads `:root`.
 */

const CSS = readFileSync(
  new URL('./tokens.reference.css', import.meta.url),
  'utf8',
)
const LIGHT = (() => {
  const start = CSS.indexOf(":root[data-theme='light'] {")
  return CSS.slice(start, CSS.indexOf('}', start))
})()

function lightToken(name: string): string {
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
  it('--chart-series is chartSeries, written as hex', () => {
    expect(lightPalette(DEFAULT_ACCENT_HUE).chartSeries).toBe(
      /--chart-series:\s*(#[0-9a-f]{6})/i.exec(LIGHT)?.[1],
    )
  })

  it.each([
    ['surface-0', 'surface0'],
    ['surface-1', 'surface1'],
    ['surface-2', 'surface2'],
    ['surface-3', 'surface3'],
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

  it('turns tag chips round so their ink still reads', () => {
    expect(tagColors(150, 'light').text).not.toBe(tagColors(150, 'dark').text)
    applyColorScheme('light')
    expect(tagColors(150)).toEqual(tagColors(150, 'light'))
  })
})
