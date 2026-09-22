import { fonts, labelTracking, radius, type, type ThemePalette } from '@selfmp3/client'

/**
 * The few shapes every screen repeats, from docs/ui-mock `S2`, so a card or a
 * page title is written once. Each takes the palette a Unistyles stylesheet is
 * given (`StyleSheet.create(theme => ({ panel: card(theme.colors) }))`), which
 * keeps it following the theme and the accent without a re-render.
 */

/**
 * A card: one step up from the ground, 18 round, no edge. On Paper it is white
 * on cream, which has no tone to tell it apart, so it casts a soft shadow
 * there; in the dark `cardShadow` is transparent and it casts none.
 */
export function card(colors: ThemePalette, cornerRadius: number = radius.card) {
  return {
    backgroundColor: colors.surface1,
    borderRadius: cornerRadius,
    boxShadow: `0 1px 2px ${colors.cardShadow}, 0 8px 24px ${colors.cardShadow}`,
  } as const
}

/** What floats over the page — a sheet, a menu, the bar — casts this. */
export function floating(colors: ThemePalette) {
  return { boxShadow: `0 10px 28px ${colors.floatShadow}` } as const
}

/**
 * What a piece of artwork casts: a cover, a mosaic, the card leaning out of a
 * tag's tile. Deeper than `floating`, because a picture sits on the page
 * rather than over it — and from the palette, which is the point: written out
 * at each site it was black at a third whatever the theme, so the light one
 * got a shadow the design system does not have.
 */
export function artShadow(colors: ThemePalette, depth: 'lean' | 'stand' = 'stand') {
  const geometry = depth === 'lean' ? '0 6px 14px' : '0 14px 34px'
  return { boxShadow: `${geometry} ${colors.floatShadow}` } as const
}

/** A page's title: the display face at 30, on a phone and a computer alike. */
export function pageTitle(colors: ThemePalette) {
  return {
    color: colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.page,
    letterSpacing: -0.4,
  } as const
}

/** A section's title inside a page: the display face at 18. */
export function sectionTitle(colors: ThemePalette) {
  return {
    color: colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.section,
    letterSpacing: -0.2,
    // The display face's last glyph leans past its own advance width, and
    // tracked tighter still it is cut off by the text's own box: "Your tags"
    // loses the tail of its s on a phone. Two points was not enough of a
    // reprieve on a real one (Xiao, 2026-09-22); six is, and is still less
    // than the space that follows any heading.
    paddingRight: 6,
  } as const
}

/** The small uppercase heading over a group: 11, tracked, quiet. */
export function label(colors: ThemePalette) {
  return {
    color: colors.textMuted,
    fontSize: type.label,
    fontWeight: '600',
    letterSpacing: labelTracking,
    textTransform: 'uppercase',
  } as const
}

/** A big number, or a greeting: the serif. It has one weight; never bold it. */
export function serif(colors: ThemePalette, size: number = type.display) {
  return { color: colors.textPrimary, fontFamily: fonts.serif, fontSize: size } as const
}
