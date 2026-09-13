import { oklchToHex, oklchToHexAlpha } from './oklch.js'

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

/** Dark, as the app was drawn; or the web's `:root[data-theme='light']`. */
export type ColorScheme = 'dark' | 'light'

/*
 * The scheme applied at launch. `buildAccent` and `tagColors` follow it, so a
 * screen asking for "the accent at this hue" gets the right one for the theme
 * without having to know there is a theme.
 */
let activeScheme: ColorScheme = 'dark'

export function currentColorScheme(): ColorScheme {
  return activeScheme
}

/** The colours the accent picker moves. Nothing else depends on the hue. */
export function buildAccent(
  hue: number,
  scheme: ColorScheme = activeScheme,
): {
  accent: string
  accentStrong: string
  accentDim: string
  onAccent: string
  /** The filled pill behind the current tab's icon: `oklch(0.45 0.13 h / 0.26)`. */
  accentPill: string
  /** The progress wash behind the mini player: the web's 26% song colour. */
  accentWash: string
  /** A selected row: `oklch(0.36 0.08 h / 0.4)`. */
  accentSelected: string
} {
  if (scheme === 'light') {
    return {
      accent: oklchToHex(0.52, 0.19, hue),
      accentStrong: oklchToHex(0.46, 0.21, hue),
      accentDim: oklchToHex(0.9, 0.05, hue),
      onAccent: oklchToHex(0.99, 0, 0),
      accentPill: oklchToHexAlpha(0.52, 0.19, hue, 0.14),
      accentWash: oklchToHexAlpha(0.52, 0.19, hue, 0.18),
      // The web's light theme draws a selected row in the dim accent itself.
      accentSelected: oklchToHex(0.9, 0.05, hue),
    }
  }
  return {
    accent: oklchToHex(0.72, 0.16, hue),
    accentStrong: oklchToHex(0.78, 0.18, hue),
    accentDim: oklchToHex(0.42, 0.1, hue),
    onAccent: oklchToHex(0.15, 0.02, hue),
    accentPill: oklchToHexAlpha(0.45, 0.13, hue, 0.26),
    accentWash: oklchToHexAlpha(0.72, 0.16, hue, 0.26),
    accentSelected: oklchToHexAlpha(0.36, 0.08, hue, 0.4),
  }
}

/** A tag's chip, in its own hue — the web's `.tag-chip` and `.is-active`. */
export function tagColors(
  hue: number,
  scheme: ColorScheme = activeScheme,
): {
  background: string
  text: string
  activeBackground: string
  activeText: string
} {
  if (scheme === 'light') {
    // The dark theme's light ink would vanish on white: the same hue, turned
    // round — a pale ground and dark ink.
    return {
      background: oklchToHexAlpha(0.9, 0.06, hue, 0.7),
      text: oklchToHex(0.42, 0.1, hue),
      activeBackground: oklchToHexAlpha(0.8, 0.1, hue, 0.85),
      activeText: oklchToHex(0.25, 0.06, hue),
    }
  }
  return {
    background: oklchToHexAlpha(0.34, 0.07, hue, 0.4),
    text: oklchToHex(0.86, 0.09, hue),
    activeBackground: oklchToHexAlpha(0.5, 0.13, hue, 0.6),
    activeText: oklchToHex(0.96, 0.04, hue),
  }
}

export type Accent = ReturnType<typeof buildAccent>

/** The dark theme's fixed colours: written by hand before any of this existed. */
const DARK = {
  surface0: '#0b0d13',
  surface1: '#11141a',
  surface2: '#1a1d25',
  surface3: '#252932',

  textPrimary: '#f4f5f9',
  textSecondary: '#aeb1b9',
  textMuted: '#7c8089',

  danger: '#f0555b',
  warning: '#ebaa2d',
  good: '#43c07a',

  border: '#2a2e36',
  borderStrong: '#3e424d',
}

export function darkPalette(hue: number = DEFAULT_ACCENT_HUE) {
  return {
    surface0: DARK.surface0,
    surface1: DARK.surface1,
    surface2: DARK.surface2,
    surface3: DARK.surface3,
    textPrimary: DARK.textPrimary,
    textSecondary: DARK.textSecondary,
    textMuted: DARK.textMuted,
    ...buildAccent(hue, 'dark'),
    danger: DARK.danger,
    warning: DARK.warning,
    good: DARK.good,
    border: DARK.border,
    borderStrong: DARK.borderStrong,
  }
}

export type ThemePalette = ReturnType<typeof darkPalette>

/**
 * The web's light theme, `:root[data-theme='light']` in tokens.css. Its
 * surfaces are tinted by the hue, faintly, as the web's are. Danger, warning
 * and good are the same in both.
 */
export function lightPalette(hue: number = DEFAULT_ACCENT_HUE): ThemePalette {
  return {
    surface0: oklchToHex(0.985, 0.004, hue),
    surface1: oklchToHex(1, 0, 0),
    surface2: oklchToHex(0.96, 0.006, hue),
    surface3: oklchToHex(0.93, 0.008, hue),
    textPrimary: oklchToHex(0.22, 0.015, hue),
    textSecondary: oklchToHex(0.44, 0.014, hue),
    textMuted: oklchToHex(0.56, 0.012, hue),
    ...buildAccent(hue, 'light'),
    danger: DARK.danger,
    warning: DARK.warning,
    good: DARK.good,
    border: oklchToHex(0.89, 0.008, hue),
    borderStrong: oklchToHex(0.8, 0.01, hue),
  }
}

/**
 * The palette every screen draws with.
 *
 * One object, filled once at launch by `applyColorScheme`, before any screen's
 * stylesheet is made: styles copy these values when they are created, so a
 * theme is chosen by what the object holds when the app starts, and changing
 * it means starting again. The dark theme is what it holds until then.
 */
export const colors: ThemePalette = darkPalette(DEFAULT_ACCENT_HUE)

/** Fill `colors` for a theme. Call once, at launch, before anything draws. */
export function applyColorScheme(scheme: ColorScheme, hue: number = DEFAULT_ACCENT_HUE): void {
  activeScheme = scheme
  Object.assign(colors, scheme === 'light' ? lightPalette(hue) : darkPalette(DEFAULT_ACCENT_HUE))
}

export const radius = { sm: 6, md: 10, lg: 16 } as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/** Matches the web app's 14px base with a compact 1.5 line height. */
export const type = {
  body: 14,
  small: 12,
  tiny: 11,
  label: 10,
  title: 17,
  large: 22,
} as const

/** The web's `--hit-target`: the smallest comfortable touch target. */
export const HIT_TARGET = 44

/** The web's `--mobile-nav-height`, before the safe-area inset is added. */
export const NAV_HEIGHT = 58

/** Height of the mini player that sits above the nav: 8px + 40px cover + 8px. */
export const MINI_PLAYER_HEIGHT = 56

/**
 * The web's motion tokens: quick and subtle. `--dur-fast`, `--dur`,
 * `--dur-slow`, and the `--ease-out` curve.
 */
export const motion = { fast: 100, base: 140, slow: 220 } as const

/**
 * The width at which the app stops being a phone and becomes a desktop.
 *
 * Below this it is a tab bar, a mini player, a full-screen now playing and
 * sheets; at and above it a sidebar, a player bar and popovers. It is a width,
 * not a platform, which is the whole point — a phone in landscape, an iPad and
 * a narrow browser window each get the layout that fits them rather than the
 * one their operating system implies.
 *
 * It lives here beside the other tokens because `docs/UNIVERSAL.md` says it
 * does: one design token source, and the breakpoint is a design token. It
 * matches the web app's `useIsMobile(820)`.
 */
export const BREAKPOINT = 820
