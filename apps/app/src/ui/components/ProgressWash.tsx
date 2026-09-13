import { useId } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { withAlpha } from '@selfmp3/client'

/**
 * How far the song has got, as a wash behind everything on a bar.
 *
 * The web's `.player-bar::before` and `.mini-progress`: the song's colour fills
 * the bar from the left, and the leading edge fades out over `fade` points
 * instead of stopping at a hard line, so it reads as light rather than as a
 * block. The line along the foot, where there is one, fades with it.
 */
export function ProgressWash({
  fraction,
  color,
  alpha,
  fade,
  footLine = false,
}: {
  /** 0 to 1. */
  fraction: number
  /** `#rrggbb`. */
  color: string
  /** How strong the wash is behind the played part. */
  alpha: number
  /** Points over which the leading edge fades out. */
  fade: number
  footLine?: boolean
}): ReactNode {
  // Gradient ids are document ids on the web: two bars must not share one.
  const id = `wash${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const width = `${Math.min(1, Math.max(0, fraction)) * 100}%` as const

  return (
    <View pointerEvents="none" style={[styles.wash, { width }]}>
      <View style={styles.played}>
        <View style={[styles.fill, { backgroundColor: withAlpha(color, alpha) }]} />
        {footLine ? <View style={[styles.line, { backgroundColor: color }]} /> : null}
      </View>
      <View style={[styles.edge, { width: fade }]}>
        <Fade id={`${id}fill`} color={color} opacity={alpha} style={styles.fill} />
        {footLine ? <Fade id={`${id}line`} color={color} opacity={1} style={styles.line} /> : null}
      </View>
    </View>
  )
}

function Fade({
  id,
  color,
  opacity,
  style,
}: {
  id: string
  color: string
  opacity: number
  style: StyleProp<ViewStyle>
}): ReactNode {
  return (
    <View style={style}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wash: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  played: { flex: 1 },
  edge: { flexShrink: 0 },
  fill: { flex: 1 },
  line: { height: 2 },
})
