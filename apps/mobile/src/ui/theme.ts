/**
 * The web app's palette, resolved to hex.
 *
 * `apps/web/src/styles/index.css` builds every colour from `oklch(L C
 * var(--accent-hue))`, and the hue is **330** — a pink. React Native can do
 * neither OKLCH nor custom properties, so the same lightness/chroma pairs are
 * converted once, here.
 *
 * These were wrong: every value came from hue 268, a blue, and the comment
 * above them asserted 268 as though it were the web's. So the two apps shared
 * a palette in prose and agreed on nothing on screen, which is most of why the
 * phone looked like a different product. They were re-derived by reading the
 * computed values out of the running web app rather than by eye — which is
 * what the old comment told the next person to do, and is worth doing again if
 * the hue ever moves.
 */
export const colors = {
  surface0: '#100b10',
  surface1: '#171217',
  surface2: '#211a21',
  surface3: '#2e262d',

  textPrimary: '#f7f4f7',
  textSecondary: '#b6aeb5',
  textMuted: '#857d84',

  accent: '#db7cd4',
  accentStrong: '#f689ed',
  accentDim: '#6b3767',
  onAccent: '#10080f',

  danger: '#f0555b',
  warning: '#ebaa2d',
  good: '#43c07a',

  border: '#332b32',
  borderStrong: '#493f47',
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
