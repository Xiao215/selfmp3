import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildAccent,
  DEFAULT_ACCENT_HUE,
  darkPalette,
  fonts,
  labelTracking,
  lightPalette,
  motion,
  radius,
  space,
  type,
} from '@selfmp3/client/core'
import { describe, expect, it } from 'vitest'

import { fontFile, fontsCss, kebab, themeCss } from './theme.mjs'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const tokens = {
  hue: DEFAULT_ACCENT_HUE,
  dark: darkPalette(DEFAULT_ACCENT_HUE),
  light: lightPalette(DEFAULT_ACCENT_HUE),
  radius,
  space,
  type,
  labelTracking,
  fonts,
  motion,
}
const css = themeCss(tokens)
const [darkPart = '', lightPart = ''] = css.split('@media (prefers-color-scheme: light)')

/** Every `--name: value` a stylesheet declares. */
function declared(text) {
  return new Map([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

/*
 * The extension's look is the app's only while the generated stylesheet says
 * what the tokens say, and while everything the extension draws with is a
 * name the stylesheet has. Both are checked here, so a token renamed in
 * packages/client fails a test instead of drawing a transparent button.
 */
describe('the generated theme', () => {
  it('writes every colour of both palettes, dark first and Paper for a light system', () => {
    const dark = declared(darkPart)
    const light = declared(lightPart)
    for (const [key, value] of Object.entries(tokens.dark)) {
      expect(dark.get(kebab(key)), key).toBe(value)
    }
    for (const [key, value] of Object.entries(tokens.light)) {
      expect(light.get(kebab(key)), key).toBe(value)
    }
    expect(dark.get('surface-0')).toBe('#0b0d13')
    expect(light.get('surface-0')).toBe('#f6f2ea')
  })

  it('keeps the accent at the default hue: the extension has no accent setting', () => {
    expect(declared(darkPart).get('accent')).toBe(buildAccent(DEFAULT_ACCENT_HUE, 'dark').accent)
    expect(declared(lightPart).get('accent')).toBe(buildAccent(DEFAULT_ACCENT_HUE, 'light').accent)
    expect(declared(darkPart).get('accent-hue')).toBe(String(DEFAULT_ACCENT_HUE))
  })

  it('writes the shapes, the type and the two faces', () => {
    const dark = declared(darkPart)
    expect(dark.get('radius-pill')).toBe('999px')
    expect(dark.get('radius-cover-sm')).toBe('8px')
    expect(dark.get('type-label')).toBe('11px')
    expect(dark.get('label-tracking')).toBe('0.9px')
    expect(dark.get('font-serif')).toMatch(/^'InstrumentSerif_400Regular', /)
    expect(dark.get('font-display')).toMatch(/^'BricolageGrotesque_600SemiBold', /)
    expect(dark.get('motion-base')).toBe('140ms')
  })

  it('writes the two curves a fade can take, which the tokens have no number for', () => {
    const dark = declared(darkPart)
    expect(dark.get('ease-out')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(dark.get('ease-in')).toBe('cubic-bezier(0.4, 0, 1, 1)')
  })

  it('sits on the pill’s shadow host as well as on a page', () => {
    expect(darkPart).toContain(':root, :host {')
    expect(lightPart).toContain(':root, :host {')
  })

  it('finds each face’s file in the package the app embeds it from', () => {
    const require = createRequire(import.meta.url)
    for (const family of Object.values(fonts)) {
      const { pkg, path, file } = fontFile(family)
      expect(existsSync(join(dirname(require.resolve(pkg)), path)), family).toBe(true)
      expect(fontsCss(fonts)).toContain(`url('/fonts/${file}')`)
    }
    expect(fontFile('InstrumentSerif_400Regular_Italic')).toEqual({
      pkg: '@expo-google-fonts/instrument-serif',
      path: '400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf',
      file: 'InstrumentSerif_400Regular_Italic.ttf',
    })
  })

  it('has every name the extension’s stylesheets and the pill draw with', () => {
    const names = declared(css)
    const sources = [
      'ui/base.css',
      'popup/popup.css',
      'options/options.css',
      'content/pill.ts',
    ].map(path => readFileSync(join(src, path), 'utf8'))
    // A tag's dot is set on the chip itself, from `tagColors`.
    const ownNames = new Set(['dot', 'dot-light'])
    const used = new Set(
      sources.flatMap(text => [...text.matchAll(/var\(--([a-z0-9-]+)/g)].map(m => m[1])),
    )
    expect(used.size).toBeGreaterThan(10)
    for (const name of used) {
      if (!ownNames.has(name)) expect(names.has(name), `--${name}`).toBe(true)
    }
  })

  it('is the only place a colour is written: the stylesheets name tokens, never values', () => {
    for (const path of [
      'ui/base.css',
      'popup/popup.css',
      'options/options.css',
      'content/pill.ts',
    ]) {
      const text = readFileSync(join(src, path), 'utf8')
      expect(text.match(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(|hsla?\(/gi), path).toBeNull()
    }
  })
})
