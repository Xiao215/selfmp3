import { useEffect, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Animated, Image, Pressable, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { motion, radius, space, type } from '@selfmp3/client'
import { artShadow, label as labelText, pageFrame, heroTitle } from '../surfaces'
import { useMotionReduced } from '../motion'
import { useSvgId } from '../useSvgId'
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
  lightFull = false,
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
  opensArt = false,
}: {
  wide: boolean
  /** The light's colour, from the lead cover (`useSongColor`), or a tag's own. */
  light: string
  /** The light is the page's own colour (a tag's tile), at full strength (`CoverLight`). */
  lightFull?: boolean
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
  /**
   * Pressing the head's picture opens it out: the words step down and the
   * picture shows whole above them; pressed again, it closes. An artist's
   * banner, which the light otherwise only hints at.
   */
  opensArt?: boolean
}): ReactNode {
  const { top } = useSafeAreaInsets()
  const [width, setWidth] = useState(0)
  const { open, lightStyle } = useOpenArt(opensArt && !!art, top, width)
  return (
    <View
      // Measured from the first frame, whether or not there is a picture to
      // open yet: a browser never measures a view that was given its
      // `onLayout` after it first appeared, and the banner arrives later.
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[
        styles.head,
        wide && styles.headWide,
        { paddingTop: top + pageFrame(wide).paddingTop },
      ]}
    >
      {/*
       * The light gives way to an opened picture, or the dim banner it draws
       * shows on under the picture's fade. The same view with or without a
       * picture to open, so the light is not drawn afresh when a banner arrives.
       */}
      <Reanimated.View pointerEvents="none" style={[styles.light, lightStyle]}>
        <CoverLight color={light} art={art} full={lightFull} />
      </Reanimated.View>
      {open && art ? (
        <>
          <OpenArt art={art} style={open.pictureStyle} />
          <Pressable
            onPress={open.toggle}
            accessibilityRole="button"
            accessibilityLabel={open.opened ? 'Show less of the picture' : 'Show the whole picture'}
            testID="place-banner"
            style={styles.artPress}
          />
        </>
      ) : null}
      {topBar ? (
        <View pointerEvents="box-none" style={styles.topBar}>
          {topBar}
        </View>
      ) : null}
      {open ? (
        <Reanimated.View
          pointerEvents="none"
          onLayout={open.onRoomLayout}
          style={[styles.room, open.roomStyle]}
        />
      ) : null}
      <Animated.View
        ref={heroRef}
        collapsable={false}
        onLayout={onHeroLayout}
        pointerEvents="box-none"
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

/** How tall the opened picture stands, as a share of the head's width: a banner's own shape. */
const OPEN_ASPECT = 2.4
/** The opened picture's height, below the status bar, whatever the head's width. */
const OPEN_HEIGHT = { min: 280, max: 440 }
/** How far up the opened picture the words still sit, where its fade has all but reached the ground. */
const OPEN_OVERLAP = 64

type AnimatedStyle = ReturnType<typeof useAnimatedStyle>

/** Between the corner buttons, the words and what comes after. */
const HEAD_GAP = 18

const SPRING = { stiffness: motion.spring.stiffness, damping: motion.spring.damping, mass: 1 }

/**
 * The head opening out to its picture. Measured, because how much room the
 * picture needs is its width's (`OPEN_ASPECT`) less what the head already
 * has above the words. The motion is Reanimated's: the room's height and the
 * picture's strength run on the UI thread, and React only ever commits
 * whether the picture is open.
 */
function useOpenArt(
  enabled: boolean,
  top: number,
  width: number,
): {
  /** The light's strength: it gives way as the picture opens. */
  lightStyle: AnimatedStyle
  /** Nothing to open: no picture, or a page whose picture does not open. */
  open: {
    opened: boolean
    toggle: () => void
    onRoomLayout: (event: LayoutChangeEvent) => void
    roomStyle: AnimatedStyle
    pictureStyle: AnimatedStyle
  } | null
} {
  const reduced = useMotionReduced()
  const [pressedOpen, setOpened] = useState(false)
  // A page that loses its picture has nothing open.
  const opened = enabled && pressedOpen
  // Where the room above the words starts: under the corner buttons.
  const [roomAt, setRoomAt] = useState(0)
  const shown = useSharedValue(0)
  const picture = Math.min(OPEN_HEIGHT.max, Math.max(OPEN_HEIGHT.min, width / OPEN_ASPECT))
  const room = Math.max(0, top + picture - OPEN_OVERLAP - roomAt)

  useEffect(() => {
    shown.value = reduced ? Number(opened) : withSpring(Number(opened), SPRING)
  }, [opened, reduced, shown])

  const roomStyle = useAnimatedStyle(() => ({ height: shown.value * room }))
  const pictureStyle = useAnimatedStyle(() => ({
    height: top + picture,
    opacity: shown.value,
  }))
  const lightStyle = useAnimatedStyle(() => ({ opacity: 1 - shown.value }))
  if (!enabled) return { lightStyle, open: null }
  return {
    lightStyle,
    open: {
      opened,
      toggle: () => setOpened(!opened),
      onRoomLayout: event => setRoomAt(event.nativeEvent.layout.y),
      roomStyle,
      pictureStyle,
    },
  }
}

/** The picture opened out: at full strength across the head's top, fading into the ground under the words. */
function OpenArt({ art, style }: { art: string; style: AnimatedStyle }): ReactNode {
  const { theme } = useUnistyles()
  const id = useSvgId('openart')
  return (
    <Reanimated.View pointerEvents="none" style={[styles.openArt, style]}>
      <Image source={{ uri: art }} style={styles.openPicture} resizeMode="cover" />
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.4" stopColor={theme.colors.surface0} stopOpacity={0} />
            <Stop offset="0.85" stopColor={theme.colors.surface0} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Reanimated.View>
  )
}

/** The words in a head, as all three pages set them. */
export const listHeadText = StyleSheet.create(theme => ({
  kind: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  kindText: labelText(theme.colors),
  // The name, and a mark of what kind of list it is beside it where it has
  // one: a tag's dot, a self-filling playlist's mark.
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  nameShrink: { flexShrink: 1 },
  name: heroTitle(theme.colors),
  summary: { color: theme.colors.textSecondary, fontSize: type.sub },
}))

const styles = StyleSheet.create(theme => ({
  head: {
    paddingHorizontal: space.gutter,
    paddingBottom: space.lg,
    gap: HEAD_GAP,
    overflow: 'hidden',
  },
  // No paddingTop here: the head's own, under the status bar, is set inline:
  // the page's top (`pageFrame`) below the inset, as every page's first row.
  headWide: { paddingHorizontal: space.gutterWide },
  // No glass here. The bar scrolls with the head rather than floating over
  // the page, and it carries no fill, so `backdrop-filter` would only blur the
  // head's own light inside the bar's rectangle — a band across the top with
  // a hard edge where the filter stops.
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hero: { gap: space.lg },
  // The head's gap comes after the room as well as before it; it gives the
  // second back, so shut it adds nothing.
  room: { marginBottom: -HEAD_GAP },
  light: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  openArt: { position: 'absolute', top: 0, left: 0, right: 0 },
  openPicture: { width: '100%', height: '100%' },
  // Under the corner buttons and the words, which let presses through where
  // they draw nothing, so the picture's whole bare part opens it.
  artPress: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // The buttons go under the name when the page cannot hold all three abreast
  // (an iPad in portrait), rather than squeezing the name to nothing.
  heroWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 28 },
  mosaic: {
    alignSelf: 'flex-start',
    ...artShadow(theme.colors),
    borderRadius: radius.card,
  },
  titles: { gap: space.tight, flexShrink: 1, minWidth: 0 },
  titlesWide: { flexGrow: 1, flexBasis: 220 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  actionsWide: { marginLeft: 'auto', paddingBottom: space.tight },
}))
