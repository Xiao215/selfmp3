import {
  fonts,
  radius,
  space,
  textStyle,
  tracking,
  type,
  type ThemePalette,
  type TypeStep,
} from '@selfmp3/client'

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

/**
 * How far a page's title sits below the top of a computer's page, as its side
 * sits `space.gutterWide` in from the sidebar: going from Library to Import to
 * Stats, the title stays put rather than jumping between each page's own
 * margins.
 */
export const PAGE_TOP_WIDE = 40

/**
 * A phone's page, under the status bar: its first row starts here, whether
 * that is the way back, Home's buttons or a title with its buttons beside it,
 * so they stay put when the tabs switch. A title under the way back sits
 * `TITLE_UNDER_BACK` below it, on every page that has one.
 */
export const PAGE_TOP_PHONE = 6
export const TITLE_UNDER_BACK = 12

const FRAME_WIDE = { paddingTop: PAGE_TOP_WIDE, paddingHorizontal: space.gutterWide } as const
const FRAME_PHONE = { paddingTop: PAGE_TOP_PHONE, paddingHorizontal: space.gutter } as const

/**
 * A page's top and sides: where its first row starts and how far in its
 * content sits, on a computer or a phone. Each page wrote these four numbers
 * itself and they drifted — 4, 16, 18 and 40 under a phone's status bar, 16
 * and 44 at the sides — so the title jumped as the tabs switched. The same
 * two objects every time, so it can sit in a style array without a new
 * object each render.
 */
export function pageFrame(wide: boolean): typeof FRAME_WIDE | typeof FRAME_PHONE {
  return wide ? FRAME_WIDE : FRAME_PHONE
}

/** A page's title: the display face at 30, on a phone and a computer alike. */
export function pageTitle(colors: ThemePalette) {
  return {
    color: colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.page,
    letterSpacing: tracking.page,
  } as const
}

/** A section's title inside a page: the display face at 18. */
export function sectionTitle(colors: ThemePalette) {
  return {
    color: colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.section,
    letterSpacing: tracking.heading,
    // The display face's last glyph leans past its own advance width, and
    // tracked tighter still it is cut off by the text's own box: "Your tags"
    // loses the tail of its s on a phone. Two points is not enough on a real
    // one; six is, and is still less than the space that follows any heading.
    paddingRight: 6,
  } as const
}

/** The small uppercase heading over a group: 11, tracked, quiet. */
export function label(colors: ThemePalette) {
  return {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontWeight: '600',
    letterSpacing: tracking.label,
    textTransform: 'uppercase',
  } as const
}

/**
 * A big number: the serif, on its step's line height. It has one weight; never
 * bold it. The serif's figures stand taller than a line the size of the type,
 * which cut the top off "20"; the scale's line height has room for them.
 */
export function serif(colors: ThemePalette, step: TypeStep = 'display') {
  return { color: colors.textPrimary, fontFamily: fonts.serif, ...textStyle(step) } as const
}

/**
 * The name at the top of a page, in the display face and big enough to wrap:
 * a tag's, a playlist's, a song's. A song's page sets it a step down on a
 * phone (`'page'`), and Now Playing's song a step further (`'large'`). The
 * pages each wrote these and their tracking drifted from -0.8 to -1.5.
 */
export function heroTitle(colors: ThemePalette, step: keyof typeof HERO_TRACKING = 'display') {
  return {
    color: colors.textPrimary,
    fontFamily: fonts.display,
    ...textStyle(step),
    letterSpacing: HERO_TRACKING[step],
  } as const
}

const HERO_TRACKING = {
  large: tracking.heading,
  page: tracking.page,
  display: tracking.hero,
} as const

/**
 * A greeting, or a person's or an artist's name at the top of their page: the
 * serif at display size. Home, a place page and onboarding each set it on
 * their own line height (48, 50, 53) and tracking (-0.5, -0.6, -0.8).
 */
export function nameTitle(colors: ThemePalette) {
  return { ...serif(colors, 'display'), letterSpacing: tracking.serif } as const
}

/** A row's or a card's title: one line of body text, set heavier. */
export function rowTitle(colors: ThemePalette) {
  return { color: colors.textPrimary, fontSize: type.body, fontWeight: '600' } as const
}

/** `rowTitle` a step down, for a line beside a small cover or in a dense card. */
export function smallTitle(colors: ThemePalette) {
  return { color: colors.textPrimary, fontSize: type.sub, fontWeight: '600' } as const
}

/** The words under a title, which may wrap: a card's or a dialog's explanation. */
export function lineSub(colors: ThemePalette) {
  return { color: colors.textSecondary, ...textStyle('sub') } as const
}

/** A paragraph of body text that is not the point of the page: a lead, a story. */
export function bodyText(colors: ThemePalette) {
  return { color: colors.textSecondary, ...textStyle('body') } as const
}

/** The quietest words, under a field or a setting: a caption that may wrap. */
export function hint(colors: ThemePalette) {
  return { color: colors.textMuted, ...textStyle('small') } as const
}

/**
 * A title and the lines under it beside a cover or an icon: taking the row's
 * spare width, allowed to shrink so its words truncate rather than push.
 */
export const textColumn = { flex: 1, minWidth: 0, gap: 2 } as const
