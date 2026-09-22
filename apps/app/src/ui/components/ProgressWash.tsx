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
 * The song's colour fills the bar from the left, and the leading edge fades
 * out over `fade` points instead of stopping at a hard line, so it reads as
 * light rather than as a block. The line along the edge, where there is one,
 * fades with it and ends where it ends.
 *
 * The fade is centred on where the song has got to rather than ending there:
 * half of it before, half after. Ending there, the wash always looked to be
 * running behind the scrubber's own handle (Xiao, 2026-09-21).
 */
export function ProgressWash({
  fraction,
  color,
  alpha,
  fade,
  line,
}: {
  /** 0 to 1. */
  fraction: number
  /** `#rrggbb`. */
  color: string
  /** How strong the wash is behind the played part. */
  alpha: number
  /** Points over which the leading edge fades out. */
  fade: number
  /**
   * A bright line along the wash's edge, and which edge it runs along. It is
   * drawn here rather than by the bar so that it ends where the wash ends: a
   * line of its own, stopping at the playhead, reads as a second and
   * disagreeing answer to how far the song has got (Xiao, 2026-09-21).
   */
  line?: 'top' | 'foot'
}): ReactNode {
  // Gradient ids are document ids on the web: two bars must not share one.
  const id = `wash${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  /*
   * Rounded, because on the web every distinct percentage becomes its own
   * atomic CSS rule that will never be reused — four new rules a second while
   * a song plays, for a difference no eye can see on a bar 300 points wide
   * (`nowPlaying/stageMove.model.ts` explains the mechanism at length).
   */
  const at = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` as const
  const half = fade / 2

  return (
    <View pointerEvents="none" style={styles.wash}>
      {/* Solid up to half a fade before the playhead. The parent carries the
          share of the bar, the child the points, so neither needs the other's
          units. */}
      <View style={[styles.played, { width: at }]}>
        {line === 'top' ? (
          <View style={[styles.line, { marginRight: half, backgroundColor: color }]} />
        ) : null}
        <View
          style={[styles.fill, { marginRight: half, backgroundColor: withAlpha(color, alpha) }]}
        />
        {line === 'foot' ? (
          <View style={[styles.line, { marginRight: half, backgroundColor: color }]} />
        ) : null}
      </View>
      {/* And out again half a fade after it. */}
      <View style={[styles.edge, { left: at, width: fade, marginLeft: -half }]}>
        {line === 'top' ? (
          <Fade id={`${id}line`} color={color} opacity={1} style={styles.line} />
        ) : null}
        <Fade id={`${id}fill`} color={color} opacity={alpha} style={styles.fill} />
        {line === 'foot' ? (
          <Fade id={`${id}line`} color={color} opacity={1} style={styles.line} />
        ) : null}
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
      {/* A box of one unit stretched over the view, rather than a width and a
          height given as percentages: on a phone those measure nothing and the
          gradient is never drawn, which left the wash ending at a hard line. */}
      <Svg style={styles.fill} viewBox="0 0 1 1" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={opacity} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="1" height="1" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wash: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // Early in a song the fade's first half reaches past the left edge.
    overflow: 'hidden',
  },
  played: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  edge: { position: 'absolute', top: 0, bottom: 0 },
  fill: { flex: 1 },
  line: { height: 2 },
})
