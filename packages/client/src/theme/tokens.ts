import { oklchToHex, oklchToHexAlpha } from './oklch.js'

/**
 * `tokens.reference.css`'s palette, resolved to hex.
 *
 * The stylesheet builds every colour from `oklch(L C var(--accent-hue))`; it
 * is kept beside the tests as `tokens.reference.css`. React Native has neither
 * OKLCH nor custom properties, so the same lightness/chroma pairs are
 * converted here instead, and the browser and the phone draw the same colours.
 *
 * The accent is worked out rather than written down, because on the phone it
 * is a setting: `buildAccent` below is given whatever hue this device has been
 * set to. Everything else is fixed — the surfaces are tinted by the hue on the
 * web too, but at a chroma of around 0.014 that is a tint nobody has ever
 * noticed, and it is not worth making every surface in the app reactive for.
 */

/** The hue everything here was written at, and what a device starts on. */
export const DEFAULT_ACCENT_HUE = 268

/** Dark, as the app was drawn; or `tokens.reference.css`'s `:root[data-theme='light']`. */
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
  /** The progress wash behind the mini player: a 26% wash of the song colour. */
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
      // The light theme draws a selected row in the dim accent itself.
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

/**
 * A tag's colours, from its hue (docs/ui-mock, `S2`).
 *
 * A tag is a place now, not a coloured button: its **tile** on Home and the
 * top of its page is the only thing drawn in its hue at any size — a deep fill
 * with light ink of the same hue in the dark, a pale tint with dark ink on
 * Paper. Everywhere else a tag is a neutral pill carrying a **dot** of its
 * hue, and a chosen chip is white, not coloured, so nine tags in nine hues
 * still read as one quiet row.
 *
 * `ink` is the tag's name drawn in its hue on the page's own ground, for the
 * few places a name stands alone (the tags under a song in Now Playing).
 */
export function tagColors(
  hue: number,
  scheme: ColorScheme = activeScheme,
): {
  /** The tile's fill. */
  tile: string
  /** The tile's name and count. */
  tileInk: string
  /** The dot on a chip, a row and the sidebar. */
  dot: string
  /** The name in its hue, on the ground. */
  ink: string
} {
  if (scheme === 'light') {
    return {
      tile: oklchToHex(0.93, 0.045, hue),
      tileInk: oklchToHex(0.38, 0.11, hue),
      dot: oklchToHex(0.66, 0.15, hue),
      ink: oklchToHex(0.42, 0.1, hue),
    }
  }
  return {
    tile: oklchToHex(0.32, 0.07, hue),
    tileInk: oklchToHex(0.85, 0.1, hue),
    dot: oklchToHex(0.8, 0.12, hue),
    ink: oklchToHex(0.86, 0.09, hue),
  }
}

export type Accent = ReturnType<typeof buildAccent>

/**
 * The dark theme's fixed colours, `S2` of docs/ui-mock: the ground, a card one
 * step up, a control, a raised control, and the white segment's dark twin.
 * There are no hairlines in this design; `border` and `borderStrong` are kept
 * for the few things that still need an edge (a focus ring, a dashed add chip)
 * and nothing new separates with them.
 */
const DARK = {
  surface0: '#0b0d13',
  surface1: '#151821',
  surface2: '#1a1d25',
  surface3: '#1f2330',
  surfaceSelected: '#2c3140',

  textPrimary: '#f4f5f9',
  textSecondary: '#aeb1b9',
  textMuted: '#7c8089',

  danger: '#f0555b',
  warning: '#ebaa2d',
  good: '#43c07a',
  /** Behind a row being swiped away. */
  remove: '#5a2a2e',

  border: '#2a2e36',
  borderStrong: '#3e424d',
}

export function darkPalette(hue: number = DEFAULT_ACCENT_HUE) {
  return {
    surface0: DARK.surface0,
    surface1: DARK.surface1,
    surface2: DARK.surface2,
    surface3: DARK.surface3,
    surfaceSelected: DARK.surfaceSelected,
    textPrimary: DARK.textPrimary,
    textSecondary: DARK.textSecondary,
    textMuted: DARK.textMuted,
    ...buildAccent(hue, 'dark'),
    danger: DARK.danger,
    warning: DARK.warning,
    good: DARK.good,
    remove: DARK.remove,
    border: DARK.border,
    borderStrong: DARK.borderStrong,
    /** Ink on the white primary fill: the round Play, a chosen chip, the active tab. */
    onPrimary: DARK.surface0,
    /**
     * The floating bar, the search circle and controls over artwork: a
     * translucent fill (no blur on native; the web adds `backdrop-filter`).
     */
    glass: '#1f222ceb',
    /** The shadow under a card. Dark cards are told apart by tone, and cast none. */
    cardShadow: '#00000000',
    /** The shadow under anything that floats: the bar, the mini player, a sheet. */
    floatShadow: '#00000073',
    // One series colour in the accent's hue, so a green theme draws green bars,
    // and recessive gridlines tinted by the hue.
    chartSeries: oklchToHex(0.62, 0.15, hue),
    chartGrid: oklchToHex(0.29, 0.014, hue),
  }
}

export type ThemePalette = ReturnType<typeof darkPalette>

/**
 * The light theme, "Paper" in `S2`: a warm ground, white cards with a soft
 * shadow (white on cream has no tone to separate it), and warm ink. Unlike the
 * dark theme's accent-tinted greys it is not moved by the hue; only the accent
 * is. Danger, warning and good are the same in both.
 */
export function lightPalette(hue: number = DEFAULT_ACCENT_HUE): ThemePalette {
  return {
    surface0: '#f6f2ea',
    surface1: '#ffffff',
    surface2: '#ebe5d9',
    surface3: '#e3dccd',
    surfaceSelected: '#ffffff',
    textPrimary: '#1b1a17',
    textSecondary: '#6b675f',
    textMuted: '#8a857b',
    ...buildAccent(hue, 'light'),
    danger: DARK.danger,
    warning: DARK.warning,
    good: '#2f9a5e',
    remove: '#f3d6d3',
    border: '#e0d9cb',
    borderStrong: '#cfc6b4',
    onPrimary: '#f6f2ea',
    glass: '#ffffffe6',
    cardShadow: '#1b1a170f',
    floatShadow: '#1b1a1724',
    chartSeries: oklchToHex(0.55, 0.16, hue),
    chartGrid: '#ebe5d9',
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
  Object.assign(colors, scheme === 'light' ? lightPalette(hue) : darkPalette(hue))
}

/**
 * `S2`'s shapes. Pills and round buttons are fully round; the rest are named
 * for what wears them. `sm`, `md` and `lg` are the old scale, kept only until
 * the last caller has moved (docs/UI-MIGRATION.md, Phase 1).
 */
export const radius = {
  pill: 999,
  sheet: 26,
  cardLg: 22,
  card: 18,
  mini: 16,
  cover: 10,
  coverSm: 8,
  sm: 6,
  md: 10,
  lg: 16,
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

/**
 * A 14px base with a compact 1.5 line height, and `S2`'s larger sizes:
 * `display` for a greeting or a name in the serif, `page` for a page title and
 * `section` for a section's in the display face, `tile` for a tag tile's name,
 * `row` over `rowSub` for a song row. `label` is the small uppercase heading
 * (11, tracked 0.9: `labelTracking`).
 */
export const type = {
  body: 14,
  small: 12,
  tiny: 11,
  label: 11,
  title: 17,
  large: 22,
  display: 46,
  page: 30,
  section: 18,
  tile: 22,
  row: 15,
  rowSub: 13,
} as const

/** The letter-spacing of `type.label`, which is always uppercase. */
export const labelTracking = 0.9

/**
 * The two faces the design adds to the system font (`S2`, "Type"). They are
 * embedded in the native build and served to the web by `expo-font`; these are
 * the family names they are registered under.
 *
 * - `serif`: Instrument Serif, for greetings, a name at the top of a page and
 *   big numbers. It has one weight; never set `fontWeight` with it.
 * - `display`: Bricolage Grotesque 600, for page and section titles and tile
 *   names. The weight is in the file, so a caller sets no `fontWeight` either.
 */
export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  display: 'BricolageGrotesque_600SemiBold',
} as const

/** `tokens.reference.css`'s `--hit-target`: the smallest comfortable touch target. */
export const HIT_TARGET = 44

/** The phone's floating tab bar and search circle (`P04`): 60 high, floating over the page. */
export const NAV_HEIGHT = 60

/** The floating mini player above the bar: 8 + a 44 cover + 8. */
export const MINI_PLAYER_HEIGHT = 60

/**
 * `tokens.reference.css`'s motion tokens: quick and subtle. `--dur-fast`,
 * `--dur`, `--dur-slow`, and the `--ease-out` curve.
 */
export const motion = {
  fast: 100,
  base: 140,
  slow: 220,
  /** The one spring for anything that moves (`S2`, `M1`): a press, a swap, a sheet. */
  spring: { stiffness: 220, damping: 24 },
} as const

/**
 * The width at which the app stops being a phone and becomes a desktop.
 *
 * Below this it is a tab bar, a mini player, a full-screen now playing and
 * sheets; at and above it a sidebar, a player bar and popovers. It is a width,
 * not a platform, which is the whole point — a phone in landscape, an iPad and
 * a narrow browser window each get the layout that fits them rather than the
 * one their operating system implies.
 *
 * It lives here beside the other tokens because `docs/ARCHITECTURE.md` says it
 * does: one design token source, and the breakpoint is a design token.
 */
export const BREAKPOINT = 820
