import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { useAccent } from '../accent'

/**
 * The three bars that say a song is playing.
 *
 * The web does this with a CSS keyframe per bar and different durations, so
 * they drift out of step and never look mechanical. React Native has no
 * keyframes, so each bar gets its own looping Animated value with the same
 * three durations — 0.9s, 0.7s and 1.1s — which produces the same wander.
 *
 * Paused freezes them part-way rather than hiding them, exactly as the web's
 * `is-paused` does: a stopped equaliser still says *this* is the song.
 */
const DURATIONS = [900, 700, 1100]

export function Equalizer({
  paused = false,
  color,
  size = 14,
}: {
  paused?: boolean
  color?: string
  size?: number
}): ReactNode {
  const accent = useAccent()
  const barColor = color ?? accent.accent
  // Created once, through state rather than a ref: these are read while
  // rendering, and a ref read during render is exactly what the compiler
  // objects to — correctly, since a ref is not a render input.
  const [bars] = useState(() => DURATIONS.map(() => new Animated.Value(0.35)))

  useEffect(() => {
    if (paused) return
    const loops = bars.map((bar, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: DURATIONS[index] ?? 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.35,
            duration: DURATIONS[index] ?? 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ),
    )
    for (const loop of loops) loop.start()
    return () => {
      for (const loop of loops) loop.stop()
    }
  }, [paused, bars])

  return (
    <View style={[styles.row, { height: size }]}>
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              backgroundColor: barColor,
              height: bar.interpolate({ inputRange: [0, 1], outputRange: [2, size] }),
            },
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 2.5, borderRadius: 1.5 },
})
