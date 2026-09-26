import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { motion, oklchToHex } from '@selfmp3/client'
import { spring, timing } from '../motion'
import { fractionOf, valueAt } from './slider.model'
import type { SliderProps } from './slider.types'

const THUMB = 18
/** How far the thumb grows under a finger, on the spring, as every press does. */
const GRAB = 1.2
/*
 * The rainbow track's stops, worked out once rather than per render. A drag
 * re-renders this component on every touch move, and the seven conversions
 * are the same seven colours every time — the track does not follow the
 * accent, it is what the accent is being chosen from.
 */
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360].map(hue => ({
  hue,
  color: oklchToHex(0.72, 0.16, hue),
}))

/**
 * The rainbow the accent is chosen from.
 *
 * Held apart from the slider and memoised, because it never changes and the
 * slider around it re-renders on every touch move of a drag. Left inline, a
 * phone would rebuild this gradient and its seven stops through
 * react-native-svg sixty-odd times a second to draw a picture identical to
 * the one already on screen.
 */
const HueTrack = memo(function HueTrack(): ReactNode {
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
          {HUE_STOPS.map(stop => (
            <Stop key={stop.hue} offset={stop.hue / 360} stopColor={stop.color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#hue)" />
    </Svg>
  )
})

/**
 * A slider on a phone: a thin track in a finger-sized hit area, answering the
 * responder system directly, as the seek bar does. The browser build uses a
 * real range input instead (`Slider.web.tsx`).
 *
 * Where the thumb is follows one value. Under a finger it is set outright, so
 * the thumb is where the finger is; a value set from somewhere else — the volume
 * changed on the lock screen — moves there over `motion.fast` rather than
 * jumping. Both run on the JavaScript driver, because a position is a layout and
 * the native driver cannot carry one; the thumb's growing under the finger is a
 * transform and does go on the native driver, on a view of its own so that the
 * two never meet on one node.
 */
export function Slider({
  value,
  min,
  max,
  step,
  label,
  onChange,
  onCommit,
  hue = false,
  width = 140,
}: SliderProps): ReactNode {
  const range = { min, max, step }
  const [local, setLocal] = useState<{ value: number; from: number } | null>(null)
  const shown = local && local.from === value ? local.value : value
  const fraction = fractionOf(shown, range)

  // Where the thumb is, and how big it is: two values, two drivers.
  const [at] = useState(() => new Animated.Value(fraction))
  const [grab] = useState(() => new Animated.Value(1))
  const dragging = useRef(false)
  useEffect(() => {
    if (dragging.current) {
      at.setValue(fraction)
      return
    }
    timing(at, fraction, motion.fast, undefined, { native: false })
  }, [at, fraction])

  const follow = (x: number): number => {
    const next = valueAt(x / width, range)
    setLocal({ value: next, from: value })
    onChange?.(next)
    return next
  }

  // Built once per width: the thumb's travel and the fill's share of the track.
  const slot = useMemo(
    () => ({
      left: at.interpolate({
        inputRange: [0, 1],
        outputRange: [-THUMB / 2, width - THUMB / 2],
      }),
    }),
    [at, width],
  )
  const fill = useMemo(
    () => ({ width: at.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }),
    [at],
  )
  const grown = useMemo(() => ({ transform: [{ scale: grab }] }), [grab])

  return (
    <View
      style={[styles.hit, { width }]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={event => {
        dragging.current = true
        spring(grab, GRAB)
        return follow(event.nativeEvent.locationX)
      }}
      onResponderMove={event => follow(event.nativeEvent.locationX)}
      onResponderRelease={event => {
        dragging.current = false
        spring(grab, 1)
        onCommit?.(follow(event.nativeEvent.locationX))
      }}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        const next = Math.max(
          min,
          Math.min(max, shown + (event.nativeEvent.actionName === 'increment' ? step : -step)),
        )
        setLocal({ value: next, from: value })
        onChange?.(next)
        onCommit?.(next)
      }}
    >
      <View pointerEvents="none" style={hue ? styles.hueTrack : styles.track}>
        {hue ? <HueTrack /> : <Animated.View style={[styles.fillAccent, fill]} />}
      </View>
      {/*
        Two views for one thumb: the outer one is moved by its `left`, which only
        the JavaScript driver can animate, and the inner one is scaled by the
        native driver. A single view carrying both would be handed to the native
        side and then written to from JavaScript.
      */}
      <Animated.View pointerEvents="none" style={[styles.thumbSlot, slot]}>
        <Animated.View style={[hue ? styles.thumbOnHue : styles.thumb, grown]} />
      </Animated.View>
    </View>
  )
}

/** The thumb's shape, shared by its two looks. */
const THUMB_SHAPE = {
  width: THUMB,
  height: THUMB,
  borderRadius: THUMB / 2,
} as const

const styles = StyleSheet.create(theme => ({
  hit: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.surface3, overflow: 'hidden' },
  hueTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  // The palette's own, so a slider is recoloured without being re-rendered.
  fillAccent: { height: '100%', backgroundColor: theme.colors.accent },
  // The slot carries the position; the thumb inside it carries the grow. Each is
  // one whole Unistyles style, because an `Animated.View` flattens its style
  // array and Unistyles can no longer tell two of its own styles apart merged.
  thumbSlot: {
    position: 'absolute',
    top: 18 - THUMB / 2,
    width: THUMB,
    height: THUMB,
  },
  thumb: { ...THUMB_SHAPE, backgroundColor: theme.colors.textPrimary },
  thumbOnHue: {
    ...THUMB_SHAPE,
    backgroundColor: theme.colors.textPrimary,
    borderWidth: 2,
    borderColor: theme.colors.surface0,
  },
}))
