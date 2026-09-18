import { Appearance } from 'react-native'
import { StyleSheet, UnistylesRuntime } from 'react-native-unistyles'
import {
  applyColorScheme,
  currentColorScheme,
  darkPalette,
  lightPalette,
  type ColorScheme,
  type ThemePalette,
} from '@selfmp3/client'

import { readHue, readTheme, resolveScheme, type ThemeChoice } from '../appearancePrefs'

/**
 * The app's two themes, as Unistyles holds them (docs/ARCHITECTURE.md, "Stack":
 * Unistyles 3).
 *
 * Both are built from the same OKLCH tokens
 * (`packages/client/src/theme/tokens.ts`), at this device's accent hue. A
 * stylesheet made with `StyleSheet.create(theme => …)` reads its colours from
 * whichever theme is showing, and Unistyles restyles it when the theme or the
 * accent changes, without a reload and without re-rendering the screen.
 */

interface AppTheme {
  readonly scheme: ColorScheme
  readonly colors: ThemePalette
}

function themeFor(scheme: ColorScheme, hue: number): AppTheme {
  return { scheme, colors: scheme === 'light' ? lightPalette(hue) : darkPalette(hue) }
}

declare module 'react-native-unistyles' {
  export interface UnistylesThemes {
    dark: AppTheme
    light: AppTheme
  }
}

const hue = readHue()
let choice = readTheme()
let currentHue = hue

StyleSheet.configure({
  themes: { dark: themeFor('dark', hue), light: themeFor('light', hue) },
  // Always a named theme, never Unistyles' adaptive mode: "System" is resolved
  // here, from `Appearance`, so a choice made after launch follows the device
  // exactly as one made before it does, on the web and on a phone alike.
  settings: { initialTheme: resolveScheme(choice, Appearance.getColorScheme()) },
})

// The palette object and the scheme-aware helpers (`buildAccent`, `tagColors`)
// follow the theme on screen, for the few things drawn outside a stylesheet.
applyColorScheme(resolveScheme(choice, Appearance.getColorScheme()), hue)

const listeners = new Set<(scheme: ColorScheme) => void>()

/**
 * The hue each theme was last built at, so neither is rebuilt for a hue it
 * already wears — and so the one that is not showing can be left behind.
 */
const builtAt: Record<ColorScheme, number> = { dark: hue, light: hue }

function recolour(scheme: ColorScheme, accentHue: number): void {
  if (builtAt[scheme] === accentHue) return
  builtAt[scheme] = accentHue
  UnistylesRuntime.updateTheme(scheme, () => themeFor(scheme, accentHue))
}

function show(scheme: ColorScheme, accentHue: number): void {
  // The theme about to be shown may have been left behind by a drag on the
  // accent picker, which only recolours what is on screen.
  recolour(scheme, accentHue)
  UnistylesRuntime.setTheme(scheme)
  applyColorScheme(scheme, accentHue)
  for (const listener of listeners) listener(scheme)
}

/**
 * Hear about every change of the scheme on screen, for colours worked out in
 * JavaScript rather than in a stylesheet. Returns the unsubscribe.
 */
export function onSchemeChange(listener: (scheme: ColorScheme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// "System" changes with the device: the OS at dusk, or a browser's own setting.
Appearance.addChangeListener(({ colorScheme }) => {
  if (choice !== 'system') return
  const scheme = resolveScheme('system', colorScheme)
  if (scheme !== currentColorScheme()) show(scheme, currentHue)
})

/** Show a theme now: dark, light, or whatever the device itself is set to. */
export function applyThemeChoice(next: ThemeChoice, accentHue: number): void {
  choice = next
  show(resolveScheme(next, Appearance.getColorScheme()), accentHue)
}

/**
 * Recolour for a new accent hue — the theme on screen, and only that one.
 *
 * This runs on every step of a drag on the accent picker, and each step costs
 * a palette and a restyle of every stylesheet that reads it. Doing that twice,
 * for a scheme nobody is looking at, is half the work of a drag spent on a
 * colour nobody can see; `show` catches the other theme up before it is put on
 * screen, which is the only moment it matters.
 */
export function applyAccentHue(accentHue: number): void {
  currentHue = accentHue
  const scheme = currentColorScheme()
  recolour(scheme, accentHue)
  applyColorScheme(scheme, accentHue)
}
