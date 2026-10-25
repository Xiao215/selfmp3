import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { coverSize, motion, radius as radii, space } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { MOVE_MS } from '../motion.model'
import { nativeDriver, useFade, useMotionReduced } from '../motion'
import { useSvgId } from '../useSvgId'

/**
 * What a page shows while what it lists is on its way (AA1): quiet shapes in
 * `surface1` where the tiles, rows and cards will be, rather than "Loading…",
 * an empty heading or a lone spinner. One for every such wait, so they all
 * look alike.
 *
 * A `Skeleton` holds the shapes (`Bone`) and draws nothing for its first
 * `MOVE_MS.skeletonWait`, so a quick answer never flashes them; the shapes are
 * laid out from the start, invisible, so the page does not move when they
 * fade in. One slow light sweeps across them together, and stands still under
 * Reduce Motion.
 */
export function Skeleton({
  children,
  label = 'Loading',
  style,
  testID,
}: {
  children: ReactNode
  /** What a screen reader hears while it waits. */
  label?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}): ReactNode {
  const reduced = useMotionReduced()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), MOVE_MS.skeletonWait)
    return () => clearTimeout(timer)
  }, [])
  const opacity = useFade(shown, motion.slow, 0)
  const [sweep] = useState(() => new Animated.Value(0))
  const sweeping = shown && !reduced
  useEffect(() => {
    if (!sweeping) return
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: MOVE_MS.skeletonSweep,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: nativeDriver,
      }),
    )
    loop.start()
    return () => {
      loop.stop()
      sweep.setValue(0)
    }
  }, [sweeping, sweep])
  return (
    <Animated.View
      style={[style, { opacity }]}
      // Nothing is said during the wait either: a quick answer is not announced as a load.
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      testID={testID}
      pointerEvents="none"
    >
      <SweepContext.Provider value={sweeping ? sweep : null}>{children}</SweepContext.Provider>
    </Animated.View>
  )
}

/** The light's place along its pass, 0 to 1, or null while it stands still. */
const SweepContext = createContext<Animated.Value | null>(null)

/**
 * One shape inside a `Skeleton`: a cover, a tile, a line of words. A width as a
 * share ("60%") is a line's; a number, a picture's.
 */
export function Bone({
  width = '100%',
  height,
  radius = radii.item,
  style,
}: {
  width?: DimensionValue
  height: DimensionValue
  radius?: number
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const sweep = useContext(SweepContext)
  const [measured, setMeasured] = useState(0)
  return (
    <View
      style={[styles.bone, { width, height, borderRadius: radius }, style]}
      // Measured from the start: the light begins after the wait, when the
      // shape has long been laid out and is not measured again.
      onLayout={event => setMeasured(event.nativeEvent.layout.width)}
    >
      {sweep && measured > 0 ? <Light sweep={sweep} width={measured} /> : null}
    </View>
  )
}

/** The band of light, a shape wide, crossing its shape from the left edge out past the right. */
function Light({ sweep, width }: { sweep: Animated.Value; width: number }): ReactNode {
  const { theme } = useUnistyles()
  const id = useSvgId('sweep')
  const move = useMemo(
    () => ({
      transform: [
        { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width, width] }) },
      ],
    }),
    [sweep, width],
  )
  return (
    <Animated.View style={[StyleSheet.absoluteFill, move]}>
      <Svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={theme.colors.surface3} stopOpacity={0} />
            <Stop offset="0.5" stopColor={theme.colors.surface3} stopOpacity={0.9} />
            <Stop offset="1" stopColor={theme.colors.surface3} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

/** How long each waiting row's title and artist are, as shares of the room: varied, as real names are. */
const ROW_WORDS = [
  ['62%', '34%'],
  ['48%', '28%'],
  ['70%', '40%'],
  ['55%', '22%'],
  ['40%', '30%'],
  ['66%', '36%'],
] as const

/**
 * A song list's rows while the list is on its way: each a cover and the two
 * lines beside it, at the rows' own height and inset (`SongRow`), so the
 * songs land where the shapes were. A computer's rows add the album and the
 * length.
 */
export function SongRowsSkeleton({
  rows = 8,
  rowHeight,
  testID,
}: {
  rows?: number
  /** `useSongRowHeight()`; null where large text lets a row grow. */
  rowHeight: number | null
  testID?: string
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const dense = useLayoutValue(layout => layout.dense)
  const cover = wide && dense ? coverSize.rowDense : coverSize.row
  return (
    <Skeleton label="Loading songs" testID={testID}>
      {Array.from({ length: rows }, (_, index) => {
        const [title, artist] = ROW_WORDS[index % ROW_WORDS.length]!
        return (
          <View
            key={index}
            style={[styles.row, wide && styles.rowWide, rowHeight ? { height: rowHeight } : null]}
          >
            {wide ? (
              <>
                {/* The checkbox's column, empty until selecting, and the position's. */}
                <View style={styles.tick} />
                <View style={styles.position}>
                  <Bone width={12} height={10} radius={radii.pill} />
                </View>
              </>
            ) : null}
            <Bone width={cover} height={cover} radius={radii.coverSm} />
            <View style={styles.words}>
              <Bone width={title} height={12} radius={radii.pill} />
              <Bone width={artist} height={10} radius={radii.pill} />
            </View>
            {wide ? (
              <>
                <View style={styles.album}>
                  <Bone width={artist} height={10} radius={radii.pill} />
                </View>
                <Bone width={32} height={10} radius={radii.pill} />
              </>
            ) : null}
          </View>
        )
      })}
    </Skeleton>
  )
}

const styles = StyleSheet.create(theme => ({
  bone: { backgroundColor: theme.colors.surface1, overflow: 'hidden' },
  // The song row's own inset and gaps (`SongRow`'s `row` and `rowWide`).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: 5,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    marginHorizontal: space.xs,
  },
  rowWide: {
    gap: space.md,
    paddingVertical: 7,
    paddingHorizontal: space.snug,
    marginHorizontal: space.sm,
  },
  tick: { width: 20 },
  position: { width: 28, alignItems: 'center' },
  words: { flex: 2, gap: space.sm },
  album: { flex: 1 },
}))
