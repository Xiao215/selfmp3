import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius } from '@selfmp3/client'
import { clamp01 } from '@selfmp3/shared'
import { ease, timing } from '../motion'
import { MOVE_MS } from '../motion.model'

/**
 * How far along something is: a 6-high track of the control surface with the
 * accent filling it from the left. Settings' storage and uploads, First sync's
 * covers, Import's run.
 *
 * A progress bar to assistive technology, with its value as a whole percent:
 * `accessibilityValue` alone is dropped by react-native-web, so the ARIA
 * attributes are set as well, and the width is rounded so a bar at a third is
 * not drawn at 33.33333%. Three copies had three heights, two tracks and one
 * that said nothing at all.
 *
 * `animated` moves the fill to each new value over `MOVE_MS.ringFill` instead
 * of jumping, for a count that ticks up a song at a time.
 */
export function ProgressBar({
  fraction,
  label,
  animated = false,
  testID,
}: {
  fraction: number
  /** What it measures, read with its value: "Songs imported". */
  label?: string
  animated?: boolean
  testID?: string
}): ReactNode {
  const percent = Math.round(clamp01(fraction) * 100)
  return (
    <View
      style={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID={testID}
    >
      {animated ? (
        <MovingFill percent={percent} />
      ) : (
        <View style={[styles.fill, { width: `${percent}%` }]} />
      )}
    </View>
  )
}

/** The fill, moved to each new value rather than jumped. */
function MovingFill({ percent }: { percent: number }): ReactNode {
  const [drawn] = useState(() => new Animated.Value(percent))
  const sent = useRef(percent)
  useEffect(() => {
    if (sent.current === percent) return
    sent.current = percent
    // A width is no transform: the native driver cannot move it.
    timing(drawn, percent, MOVE_MS.ringFill, undefined, { easing: ease.out, native: false })
  }, [percent, drawn])
  const [width] = useState(() =>
    drawn.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
  )
  return <Animated.View style={[styles.fill, { width }]} />
}

const styles = StyleSheet.create(theme => ({
  track: {
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: theme.colors.accent },
}))
