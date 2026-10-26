import { clamp, hasColour, rgbToOklch, type CoverTone } from '@selfmp3/shared'
import { oklchToHex } from '../theme/oklch.js'
import { hexToRgb } from './palette.js'
import { currentColorScheme, tagColors, type ColorScheme } from '../theme/tokens.js'

/**
 * What to draw a playing song in, from its cover's colour.
 *
 * Which colour a cover is gets picked once, by the server, with the shared
 * arithmetic in `coverTone.ts`. What that colour becomes on screen belongs to
 * the screen: `color`, for washes and lines, and `tint`, for text — kept
 * readable against the rows whatever the cover was, so a black cover never
 * makes a black title, on the dark theme or the light one.
 *
 * What comes out is hex rather than CSS `oklch()`, which React Native cannot
 * read.
 */

export interface SongColors {
  /** For washes, lines and fills. */
  readonly color: string
  /** For text and the equaliser on the rows. */
  readonly tint: string
}

/**
 * The letter tile's colour, for a song with no cover: `Cover` draws it as a
 * tag's tile in that hue (`tagColors(hue).tile`), so the tint matches what is
 * on screen in either theme.
 */
export function tileTone(
  hue: number,
  scheme: ColorScheme = currentColorScheme(),
): Pick<CoverTone, 'hue' | 'chroma'> {
  const [r, g, b] = hexToRgb(tagColors(hue, scheme).tile)
  const { c, h } = rgbToOklch(r, g, b)
  return { hue: h, chroma: c }
}

/**
 * The wash for a cover with no colour in it: a grey as light as the cover,
 * from its palette. The text is not decided here — `useSongColor` gives it
 * the accent, so a playing row in grey still reads as playing rather than as
 * selected, which is the one thing a grey wash on its own could not say.
 *
 * Pushed up on the dark theme and down on the light one, the way a colour's
 * wash is, so a mid-grey photograph still shows on the rows; a pale cover
 * (Chopin, on white paper) gives a near-white wash, a dark one a darker grey.
 */
export function neutralWash(
  { palette }: CoverTone,
  scheme: ColorScheme = currentColorScheme(),
): string {
  const lightness =
    palette.reduce((sum, swatch) => sum + swatch.l * swatch.share, 0) /
    palette.reduce((sum, swatch) => sum + swatch.share, 0)
  return scheme === 'light'
    ? oklchToHex(0.35 + 0.35 * lightness, 0, 0)
    : oklchToHex(0.55 + 0.35 * lightness, 0, 0)
}

/**
 * A cover's colour taken deep enough to carry the theme's own text over it:
 * dark on the dark theme, pale on the light one. Stats' first place veils its
 * blurred cover in this rather than in grey, so a pale pink cover gives a rose
 * card instead of the grey every pale cover used to give (Xiao chose A1,
 * 2026-10-25). A cover with no colour in it gives a grey.
 */
export function deepWash(tone: CoverTone, scheme: ColorScheme = currentColorScheme()): string {
  const chroma = hasColour(tone) ? clamp(tone.chroma * 1.4, 0.05, 0.11) : 0
  return scheme === 'light'
    ? oklchToHex(0.9, chroma * 0.6, tone.hue)
    : oklchToHex(0.3, chroma, tone.hue)
}

/** The two colours to draw with, from a cover's tone. */
export function songColors(
  { hue, chroma }: Pick<CoverTone, 'hue' | 'chroma'>,
  scheme: ColorScheme = currentColorScheme(),
): SongColors {
  // Chroma is pushed up for the wash: a pastel cover (the pale sky of オリオン
  // measures about 0.05) would otherwise wash the row in grey, which reads as
  // "selected", not "blue".
  const washChroma = clamp(chroma * 1.6, 0.11, 0.18)
  if (scheme === 'light') {
    return {
      color: oklchToHex(0.58, washChroma, hue),
      tint: oklchToHex(0.45, clamp(chroma * 1.4, 0.1, 0.16), hue),
    }
  }
  return {
    // Mid lightness so a wash of it shows on the dark rows.
    color: oklchToHex(0.68, washChroma, hue),
    tint: oklchToHex(0.87, clamp(chroma, 0.06, 0.11), hue),
  }
}

/** A cover, or a letter tile, to sweep a message in: its colour, and the cover's palette where there is one. */
export type SweepTone = Pick<CoverTone, 'hue' | 'chroma'> & {
  readonly palette?: CoverTone['palette']
}

/** Below this a swatch is grey, however its hue reads (`MIN_COLOURFULNESS` in `coverTone.ts`). */
const GREY_SWATCH = 0.02

/**
 * The colours a grey message about songs is swept in, left to right (the
 * deleted-song toast, B, 2026-10-26): from one song, the two colours most of
 * its cover is made of; from several, each one's own colour, in the order
 * their covers are fanned. Taken to a wash's lightness, as `songColors` does,
 * so a dark cover still shows on the card; a grey swatch stays grey.
 */
export function coverSweep(
  tones: readonly SweepTone[],
  scheme: ColorScheme = currentColorScheme(),
): string[] {
  const swept = (hue: number, chroma: number): string =>
    oklchToHex(
      scheme === 'light' ? 0.58 : 0.68,
      chroma < GREY_SWATCH ? 0 : clamp(chroma * 1.6, 0.11, 0.18),
      hue,
    )
  const [only] = tones
  if (tones.length !== 1 || !only) return tones.map(tone => swept(tone.hue, tone.chroma))
  const [first, second] = only.palette ?? []
  if (!first || !second) {
    const one = swept(only.hue, only.chroma)
    return [one, one]
  }
  return [swept(first.h, first.c), swept(second.h, second.c)]
}

/**
 * A colour at an alpha, for a wash of a colour worked out at runtime.
 *
 * A `#rrggbb` gets an alpha byte. Anything else is left whole and mixed with
 * transparency by the browser: in a browser, a Unistyles stylesheet's
 * `theme.colors.x` is not a hex string but `var(--colors-x)`, and slicing an
 * alpha byte onto that made `var(--c1a` — an unclosed function that Chrome's
 * CSS parser could not recover from, so every rule written after it in the
 * page's one stylesheet was dropped (tag pills drawn in black, a row's title
 * dark, the player bar without its slider, after pressing any button).
 */
export function withAlpha(color: string, alpha: number): string {
  const opacity = clamp(alpha, 0, 1)
  if (!color.startsWith('#')) {
    return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`
  }
  // `#rgb` and `#rgba` spelt out, so slicing never leaves a five-digit colour.
  const digits = color.slice(1)
  const long =
    digits.length === 3 || digits.length === 4 ? [...digits].map(d => d + d).join('') : digits
  const byte = Math.round(opacity * 255)
  // An alpha already there is replaced, not compounded.
  return `#${long.slice(0, 6)}${byte.toString(16).padStart(2, '0')}`
}
