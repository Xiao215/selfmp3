import { memo, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { oklchToHex } from '@selfmp3/client'
import { fractionOf, valueAt } from './slider.model'
import type { SliderProps } from './slider.types'

const THUMB = 18
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

  const follow = (x: number): number => {
    const next = valueAt(x / width, range)
    setLocal({ value: next, from: value })
    onChange?.(next)
    return next
  }

  return (
    <View
      style={[styles.hit, { width }]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={event => follow(event.nativeEvent.locationX)}
      onResponderMove={event => follow(event.nativeEvent.locationX)}
      onResponderRelease={event => onCommit?.(follow(event.nativeEvent.locationX))}
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
      <View pointerEvents="none" style={[styles.track, hue && styles.hueTrack]}>
        {hue ? (
          <HueTrack />
        ) : (
          <View style={[styles.fill, styles.fillAccent, { width: `${fraction * 100}%` }]} />
        )}
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left: fraction * width - THUMB / 2 }, hue && styles.thumbOnHue]}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  hit: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.surface3, overflow: 'hidden' },
  hueTrack: { height: 6, borderRadius: 3 },
  fill: { height: '100%' },
  // The palette's own, so a slider is recoloured without being re-rendered.
  fillAccent: { backgroundColor: theme.colors.accent },
  thumbOnHue: { borderWidth: 2, borderColor: theme.colors.surface0 },
  thumb: {
    position: 'absolute',
    top: 18 - THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.colors.textPrimary,
  },
}))
