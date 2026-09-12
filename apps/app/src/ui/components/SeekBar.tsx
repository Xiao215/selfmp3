import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { formatDuration } from '@selfmp3/shared'
import { useAccent } from '../accent'
import { colors, space, type } from '@selfmp3/client'

/**
 * Scrubber: the web's `.scrubber-large`, a 6px track with a 16px thumb that
 * is always there, in a hit area big enough to grab while walking.
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
  const accent = useAccent()
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
      <View
        style={styles.hit}
        onLayout={onLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
        {...responder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: width * ratio, backgroundColor: accent.accent }]} />
          <View
            style={[
              styles.thumb,
              {
                left: Math.max(0, width * ratio - THUMB / 2),
                transform: [{ scale: dragging === null ? 1 : 1.2 }],
              },
            ]}
          />
        </View>
      </View>
      {/* Elapsed on the left, what is left on the right — the phone's page on the web. */}
      <View style={styles.times}>
        <Text style={styles.time}>{formatDuration(shown)}</Text>
        <Text style={styles.time}>-{formatDuration(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  )
}

const THUMB = 16

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  hit: {
    paddingVertical: space.md,
    justifyContent: 'center',
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface3,
    justifyContent: 'center',
  },
  fill: {
    height: 6,
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.textPrimary,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  time: {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
  },
})
