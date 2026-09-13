import { useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { oklchToHex } from '@selfmp3/client'
import { useAccent } from '../accent'
import { fractionOf, valueAt } from './slider.model'
import type { SliderProps } from './slider.types'

const THUMB = 18
const HUES = [0, 60, 120, 180, 240, 300, 360]

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
  const { theme } = useUnistyles()
  const accent = useAccent()
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
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
                {HUES.map(h => (
                  <Stop key={h} offset={h / 360} stopColor={oklchToHex(0.72, 0.16, h)} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#hue)" />
          </Svg>
        ) : (
          <View
            style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: accent.accent }]}
          />
        )}
      </View>
      <View
        pointerEvents="none"
        style={[
          styles.thumb,
          { left: fraction * width - THUMB / 2 },
          hue && { borderWidth: 2, borderColor: theme.colors.surface0 },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  hit: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: theme.colors.surface3, overflow: 'hidden' },
  hueTrack: { height: 6, borderRadius: 3 },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    top: 18 - THUMB / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.colors.textPrimary,
  },
}))
