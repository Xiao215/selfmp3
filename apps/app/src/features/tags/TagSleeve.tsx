import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Circle, Path } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { radius, tagColors } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { Cover } from '../../ui/components/Cover'
import { Play } from '../../ui/components/Icons'
import { useFade } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { artShadow } from '../../ui/surfaces'

/** A tag's tile is this many times as wide as it is tall: the sleeve, and the record out of it. */
export const SLEEVE_ASPECT = 1.6

/** The record's grooves, as radii of a 100-wide disc. */
const GROOVES = [46, 43, 40, 37, 34, 31, 28, 25, 22]

/** An arc of light across the grooves, from one angle to another, in degrees. */
function sheen(from: number, to: number): string {
  const point = (r: number, deg: number): string => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
  }
  return `M${point(20, from)} L${point(49, from)} A49 49 0 0 1 ${point(49, to)} L${point(20, to)} A20 20 0 0 0 ${point(20, from)}Z`
}
/**
 * Each arc of light is five thin slices, brightest in the middle, so its
 * edges fade the way light on vinyl does instead of ending in a hard line.
 */
const SHEEN = [
  ...[0.012, 0.024, 0.036, 0.024, 0.012].map((opacity, i) => ({
    d: sheen(24 + i * 9, 33 + i * 9),
    opacity,
  })),
  ...[0.009, 0.018, 0.027, 0.018, 0.009].map((opacity, i) => ({
    d: sheen(204 + i * 8, 212 + i * 8),
    opacity,
  })),
]

/**
 * A record, drawn: black vinyl, its grooves, two arcs of light that show it
 * turning, and a label in the tag's colour. Black in both themes, as records
 * are; only the hole is the page showing through.
 */
const RecordDisc = memo(function RecordDisc({
  size,
  label,
}: {
  size: number
  label: string
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={50} fill="#121318" />
      {GROOVES.map(r => (
        <Circle
          key={r}
          cx={50}
          cy={50}
          r={r}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.05}
          strokeWidth={0.7}
        />
      ))}
      {SHEEN.map(slice => (
        <Path key={slice.d} d={slice.d} fill="#ffffff" fillOpacity={slice.opacity} />
      ))}
      <Circle cx={50} cy={50} r={18} fill="#0b0c0f" />
      <Circle cx={50} cy={50} r={16.5} fill={label} />
      <Circle cx={50} cy={50} r={2.2} fill={theme.colors.surface0} />
    </Svg>
  )
})

/**
 * A tag's picture on All tags (Xiao's pick A3, 2026-10-02): the cover of its
 * lead song as a sleeve, and a record half out of it with the tag's colour on
 * its label. Playlists are square covers in a grid; a tag is a record, so the
 * two are told apart at a glance.
 *
 * `out` is the pointer resting on the tile, or the keyboard on it: the record
 * slides a little further out and turns, and Play shows on the label (pick G).
 * Rest is drawn by the layout; the move is only a transform, so a slow frame
 * cannot leave the record anywhere but where it belongs.
 */
export const TagSleeve = memo(function TagSleeve({
  song,
  hue,
  name,
  width,
  out,
}: {
  /** Whose cover the sleeve wears; none for a tag with no songs. */
  song: Song | null
  hue: number
  name: string
  width: number
  out: boolean
}): ReactNode {
  const height = Math.round(width / SLEEVE_ASPECT)
  const disc = Math.round(height * 0.92)
  const art = useArt(height)
  const shown = useFade(out, MOVE_MS.record, MOVE_MS.record)
  const motionStyle = useMemo(
    () => ({
      transform: [
        { translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [0, disc * 0.06] }) },
      ],
    }),
    [shown, disc],
  )
  const turn = useMemo(
    () => ({
      transform: [
        { rotate: shown.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '60deg'] }) },
      ],
    }),
    [shown],
  )
  const glyph = useMemo(() => ({ opacity: shown }), [shown])
  return (
    <View style={{ width, height }} pointerEvents="none">
      <Animated.View
        style={[
          styles.disc,
          { width: disc, height: disc, left: Math.round(width * 0.41), top: (height - disc) / 2 },
          motionStyle,
        ]}
      >
        <Animated.View style={turn}>
          <RecordDisc size={disc} label={tagColors(hue).dot} />
        </Animated.View>
        <Animated.View style={[styles.glyph, glyph]}>
          <Play size={Math.max(12, Math.round(disc * 0.12))} color="#0b0d13" />
        </Animated.View>
      </Animated.View>
      <View style={[styles.sleeve, { width: height, height }]}>
        <Cover
          uri={song ? art(song) : null}
          title={song ? song.album || song.title : name}
          size={height}
          radius={radius.cover}
        />
      </View>
    </View>
  )
})

const styles = StyleSheet.create(theme => ({
  disc: { position: 'absolute', borderRadius: radius.pill, ...artShadow(theme.colors, 'lean') },
  glyph: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // The triangle's weight sits left of its box; nudged so it looks centred on the label.
    paddingLeft: 2,
  },
  sleeve: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: radius.cover,
    ...artShadow(theme.colors, 'lean'),
  },
}))
