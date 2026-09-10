import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { formatDuration } from '@selfmp3/shared'
import { colors, space, type } from '../theme'

/**
 * Scrubber.
 *
 * Hand-built on PanResponder rather than a slider package: it is thirty lines,
 * it avoids a dependency, and it lets the bar keep showing the dragged
 * position while the finger is down instead of fighting the player's own
 * progress updates.
 *
 * The responder is rebuilt when the width or the track changes rather than
 * reading refs — PanResponder objects are cheap, and the alternative is a
 * handler that quietly seeks using the previous track's duration.
 */
export function SeekBar({
  position,
  duration,
  onSeek,
}: {
  position: number
  duration: number
  onSeek: (seconds: number) => void
}): ReactNode {
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)

  const responder = useMemo(() => {
    // locationX is relative to the view that captured the gesture, which is
    // the one thing that stays correct as the bar moves around the screen.
    const secondsAt = (x: number): number => {
      if (width <= 0 || duration <= 0) return 0
      return Math.max(0, Math.min(1, x / width)) * duration
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => setDragging(secondsAt(event.nativeEvent.locationX)),
      onPanResponderMove: event => setDragging(secondsAt(event.nativeEvent.locationX)),
      onPanResponderRelease: event => {
        const target = secondsAt(event.nativeEvent.locationX)
        setDragging(null)
        onSeek(target)
      },
      onPanResponderTerminate: () => setDragging(null),
    })
  }, [width, duration, onSeek])

  const shown = dragging ?? position
  const ratio = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0

  const onLayout = (event: LayoutChangeEvent): void => {
    setWidth(event.nativeEvent.layout.width)
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.hit} onLayout={onLayout} {...responder.panHandlers}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: width * ratio }]} />
          <View style={[styles.thumb, { left: Math.max(0, width * ratio - 6) }]} />
        </View>
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(shown)}</Text>
        <Text style={styles.time}>{formatDuration(duration)}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  hit: {
    paddingVertical: space.md,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
    justifyContent: 'center',
  },
  fill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accentStrong,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
  },
})
