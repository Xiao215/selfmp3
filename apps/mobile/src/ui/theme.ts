/**
 * The web app's palette, resolved to hex.
 *
 * `apps/web/src/styles/index.css` builds every colour from `oklch(L C
 * var(--accent-hue))` with a hue of 268. React Native cannot do OKLCH or CSS
 * custom properties, so the same lightness/chroma pairs are converted once,
 * here, and the two apps stay visually identical. If the web accent hue ever
 * changes, re-derive these rather than eyeballing them.
 */
export const colors = {
  surface0: '#0b0d13',
  surface1: '#11141a',
  surface2: '#1a1d25',
  surface3: '#252932',

  textPrimary: '#f4f5f9',
  textSecondary: '#aeb1b9',
  textMuted: '#7c8089',

  accent: '#7a9eff',
  accentStrong: '#86afff',
  accentDim: '#364983',
  onAccent: '#080b14',

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
