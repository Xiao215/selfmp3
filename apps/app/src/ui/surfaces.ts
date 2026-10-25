import {
  HIT_TARGET,
  radius,
  space,
  textStyle,
  tracking,
  type,
  type ThemePalette,
  type TypeStep,
} from '@selfmp3/client'
import { fonts } from '../ports/fonts'

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
 * A dialog's widest: a question and its two buttons (`confirm`), a form or a
 * list to check (`form`), a dialog with columns (`wide`).
 */
const DIALOG_WIDTH = { confirm: 400, form: 460, wide: 880 } as const

/**
 * A dialog's panel: a card's tone at the sheet's corners, floating, clipping
 * what scrolls inside it, and as wide as the room up to its size. Left
 * without a size, the look alone, for a panel whose width is its own (the
 * command palette's grows with an answer). Each dialog drew its own and
 * they differed in nothing but their widths.
 */
export function dialogPanel(colors: ThemePalette, size?: keyof typeof DIALOG_WIDTH) {
  const look = {
    backgroundColor: colors.surface1,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    ...floating(colors),
  } as const
  return size === undefined
    ? look
    : ({ ...look, width: '100%', maxWidth: DIALOG_WIDTH[size] } as const)
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

/**
 * The layers that stand over a page, from any component: a list's pinned
 * head, its scrollbar and the playing song's mark on it, and a hover caption
 * over everything. A component's own stacking (the stage's cover over its
 * words) stays its own.
 */
export const Z = {
  pinnedHeader: 10,
  scrollbar: 11,
  scrollbarMark: 12,
  /** "Skip to the page", over the sidebar while it has the focus. */
  skipLink: 13,
  tooltip: 10000,
} as const

/**
 * A line of a menu or a list of choices (`SheetItem`, the tag picker's, the
 * command palette's): a finger's, 48 tall. `menuItemDense` is the same line in
 * a panel with a mouse, 8 by 10. Each list drew its own, and the same kind of
 * line was 40, 44 and 48 tall with a gap of 9 to 12.
 */
export const menuItem = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.md,
  minHeight: HIT_TARGET + 4,
  paddingHorizontal: space.md,
  borderRadius: radius.item,
} as const

export const menuItemDense = {
  minHeight: 0,
  gap: space.snug,
  paddingVertical: space.sm,
  paddingHorizontal: space.snug,
} as const

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
    ...headroom(step),
    letterSpacing: HERO_TRACKING[step],
  } as const
}

/**
 * Room over a big title's first line for the glyphs that stand above it, in
 * padding the same margin takes back, so the title sits where it did. The
 * scale sets these lines shorter than the faces' own, and iOS shortens a line
 * from its top: a name in Chinese falls back to PingFang, whose deeper descent
 * lifts the baseline, and 中文流行 drew flat-topped on a phone (2026-10-24).
 * The text's box is all it may draw in; the padding is part of it.
 */
export function headroom(step: TypeStep) {
  const room = Math.ceil(type[step] / 4)
  return { paddingTop: room, marginTop: -room } as const
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
  return {
    ...serif(colors, 'display'),
    ...headroom('display'),
    letterSpacing: tracking.serif,
  } as const
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
