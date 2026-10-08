import type { ReactNode, RefObject } from 'react'
import { Animated, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fonts, radius, space } from '@selfmp3/client'
import { artShadow, label as labelText } from '../surfaces'
import { CoverLight } from './CoverLight'

/** What a page may change of the head's computer layout; a tag's page is the default. */
interface WideOverrides {
  readonly hero?: StyleProp<ViewStyle>
  readonly titles?: StyleProp<ViewStyle>
  readonly actions?: StyleProp<ViewStyle>
}

/**
 * The head of a list's page: a tag's or an artist's (`PlacePage`), a
 * playlist's (`PlaylistDetailScreen`) and an answer to Ask's
 * (`AnswerScreen`), so the three read as one kind of page (docs/ui-mock `P08`,
 * `P17`, `C06`, `C08`).
 *
 * Lit by its covers (`CoverLight`), which run up behind the status bar so the
 * page is lit to its own top edge; then the corner buttons, and the hero: the
 * mosaic, the words, the buttons. On a computer the hero is one row with the
 * buttons at its end. The light stays inside the head, so it never runs on
 * under the rows.
 */
export function ListHead({
  wide,
  light,
  art,
  topBar,
  heroRef,
  heroStyle,
  onHeroLayout,
  cover,
  titles,
  actions,
  after,
  wideOverrides,
}: {
  wide: boolean
  /** The light's colour, from the lead cover (`useSongColor`). */
  light: string
  /** A picture behind the light — an artist's banner — or none. */
  art: string | null | undefined
  /** The round buttons in the corners; none on a page that has no way back here. */
  topBar: ReactNode
  heroRef?: RefObject<View | null>
  /** Moves the hero (a tag growing out of its Home tile). */
  heroStyle?: StyleProp<ViewStyle>
  onHeroLayout?: (event: LayoutChangeEvent) => void
  /** The mosaic, or none (an artist alone has the light instead). */
  cover: ReactNode
  titles: ReactNode
  actions: ReactNode
  /** Under the hero, inside the light: Ask's "Change it". */
  after?: ReactNode
  wideOverrides?: WideOverrides
}): ReactNode {
  const { top } = useSafeAreaInsets()
  return (
    <View style={[styles.head, wide && styles.headWide, { paddingTop: top + 8 }]}>
      <CoverLight color={light} art={art} />
      {topBar ? <View style={styles.topBar}>{topBar}</View> : null}
      <Animated.View
        ref={heroRef}
        collapsable={false}
        onLayout={onHeroLayout}
        style={[styles.hero, wide && [styles.heroWide, wideOverrides?.hero], heroStyle]}
      >
        {cover ? <View style={styles.mosaic}>{cover}</View> : null}
        <View style={[styles.titles, wide && [styles.titlesWide, wideOverrides?.titles]]}>
          {titles}
        </View>
        <View style={[styles.actions, wide && [styles.actionsWide, wideOverrides?.actions]]}>
          {actions}
        </View>
      </Animated.View>
      {after}
    </View>
  )
}

/** The words in a head, as all three pages set them. */
export const listHeadText = StyleSheet.create(theme => ({
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindText: labelText(theme.colors),
  name: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  summary: { color: theme.colors.textSecondary, fontSize: 14 },
}))

const styles = StyleSheet.create(theme => ({
  head: { paddingHorizontal: space.gutter, paddingBottom: 16, gap: 18, overflow: 'hidden' },
  // No paddingTop here: the head's own, under the status bar, is set inline.
  headWide: { paddingHorizontal: space.gutterWide },
  // No glass here. The bar scrolls with the head rather than floating over
  // the page, and it carries no fill, so `backdrop-filter` only blurred the
  // head's own light inside the bar's rectangle — a band across the top with
  // a hard edge where the filter stopped (Xiao, 2026-09-21).
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  hero: { gap: 16 },
  // The buttons go under the name when the page cannot hold all three abreast
  // (an iPad in portrait), rather than squeezing the name to nothing.
  heroWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 28 },
  mosaic: {
    alignSelf: 'flex-start',
    ...artShadow(theme.colors),
    borderRadius: radius.card,
  },
  titles: { gap: 6, flexShrink: 1, minWidth: 0 },
  titlesWide: { flexGrow: 1, flexBasis: 220 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsWide: { marginLeft: 'auto', paddingBottom: 6 },
}))
