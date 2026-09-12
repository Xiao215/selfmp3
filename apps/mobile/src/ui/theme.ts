import { oklchToHex } from './oklch'

/**
 * The web app's palette, resolved to hex.
 *
 * `apps/web/src/styles/parts/tokens.css` builds every colour from `oklch(L C
 * var(--accent-hue))`. React Native has neither OKLCH nor custom properties,
 * so the same lightness/chroma pairs are converted here instead, and the two
 * apps stay visually identical.
 *
 * The accent is worked out rather than written down, because on the phone it
 * is a setting: `buildAccent` below is given whatever hue this device has been
 * set to. Everything else is fixed — the surfaces are tinted by the hue on the
 * web too, but at a chroma of around 0.014 that is a tint nobody has ever
 * noticed, and it is not worth making every surface in the app reactive for.
 */

/** The hue everything here was written at, and what a device starts on. */
export const DEFAULT_ACCENT_HUE = 268

/** The four colours the accent picker moves. Nothing else depends on the hue. */
export function buildAccent(hue: number): {
  accent: string
  accentStrong: string
  accentDim: string
  onAccent: string
} {
  return {
    accent: oklchToHex(0.72, 0.16, hue),
    accentStrong: oklchToHex(0.78, 0.18, hue),
    accentDim: oklchToHex(0.42, 0.1, hue),
    onAccent: oklchToHex(0.15, 0.02, hue),
  }
}

export type Accent = ReturnType<typeof buildAccent>

export const colors = {
  surface0: '#0b0d13',
  surface1: '#11141a',
  surface2: '#1a1d25',
  surface3: '#252932',

  textPrimary: '#f4f5f9',
  textSecondary: '#aeb1b9',
  textMuted: '#7c8089',

  ...buildAccent(DEFAULT_ACCENT_HUE),

  danger: '#f0555b',
  warning: '#ebaa2d',
  good: '#43c07a',

  border: '#2a2e36',
  borderStrong: '#3e424d',
} as const

export const radius = { sm: 6, md: 10, lg: 16 } as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** Matches the web app's 14px base with a compact 1.5 line height. */
export const type = {
  body: 14,
  small: 12,
  tiny: 11,
  title: 17,
  large: 22,
} as const

/** Height of the custom bottom nav, before the safe-area inset is added. */
export const NAV_HEIGHT = 56

/** Height of the mini player that sits above the nav. */
export const MINI_PLAYER_HEIGHT = 58
