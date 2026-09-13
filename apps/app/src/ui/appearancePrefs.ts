import { DEFAULT_ACCENT_HUE, type ColorScheme } from '@selfmp3/client'

import { prefs } from '../ports/prefs'

/**
 * How this device looks, as it is kept: the accent's hue and the theme.
 *
 * Read in two places — once at launch, before anything draws, to fill the
 * palette, and by the accent provider — so the reading lives here once.
 */

export const ACCENT_KEY = 'accent'
export const THEME_KEY = 'theme'

/** Dark, light, or whatever this device's own setting is. */
export type ThemeChoice = 'dark' | 'light' | 'system'

export function readHue(): number {
  try {
    const raw = prefs.get(ACCENT_KEY)
    if (raw === null) return DEFAULT_ACCENT_HUE
    const parsed: unknown = JSON.parse(raw)
    const hue =
      typeof parsed === 'object' && parsed !== null ? (parsed as { hue?: unknown }).hue : undefined
    // Anything else — a file from a newer build, a half-written one — is just
    // the default. There is nothing here worth failing to start over.
    return typeof hue === 'number' && Number.isFinite(hue) && hue >= 0 && hue < 360
      ? Math.round(hue)
      : DEFAULT_ACCENT_HUE
  } catch {
    return DEFAULT_ACCENT_HUE
  }
}

export function readTheme(): ThemeChoice {
  const stored = prefs.get(THEME_KEY)
  return stored === 'light' || stored === 'system' ? stored : 'dark'
}

/** The scheme a choice means, given what the device itself is set to. */
export function resolveScheme(
  choice: ThemeChoice,
  /** What the device reports: 'light', 'dark', 'unspecified', or nothing. */
  system: string | null | undefined,
): ColorScheme {
  if (choice === 'system') return system === 'light' ? 'light' : 'dark'
  return choice
}
