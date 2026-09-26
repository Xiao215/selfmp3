import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useAccent } from '../accent'

/**
 * The three bars that say a song is playing.
 *
 * The web does this with a CSS keyframe per bar and different durations, so
 * they drift out of step and never look mechanical. React Native has no
 * keyframes, so each bar gets its own looping Animated value with the same
 * three durations — 0.9s, 0.7s and 1.1s — which produces the same wander.
 *
 * Paused freezes them part-way rather than hiding them: a stopped equaliser
 * still says *this* is the song. It keeps going under Reduce Motion, on
 * purpose (docs/features/design-system.md): it is saying that something is
 * still happening, not decorating a change.
 */
const DURATIONS = [900, 700, 1100]

/** How low a bar drops between strokes, as a share of its height. */
const LOW = 0.35

/** How tall a bar is `phase` milliseconds into its cycle of a stroke up and one down. */
function barAt(phase: number, duration: number): number {
  const rising = phase < duration
  const t = Easing.inOut(Easing.ease)((rising ? phase : phase - duration) / duration)
  return rising ? LOW + (1 - LOW) * t : 1 - (1 - LOW) * t
}

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
  const [bars] = useState(() => DURATIONS.map(() => new Animated.Value(LOW)))

  // Where each bar is in its stroke, kept as a time and not read back from
  // the value: the values move on the native side, and asking one where it is
  // would mean streaming every frame of three bars across the bridge for as
  // long as a song plays. A stroke up and a stroke down are one cycle; a bar
  // is at some phase of its cycle, and a pause only stops the clock.
  const phases = useRef(DURATIONS.map(() => ({ phase: 0, since: null as number | null })))

  useEffect(() => {
    if (paused) return
    // A scale, on the native driver, rather than a height on the JS thread:
    // the bar's height was a layout pass per frame per bar, for as long as a
    // song played, on a thread that also has to scroll the list it sits in.
    //
    // Each bar picks its stroke up where a pause froze it and finishes it
    // over the time it had left, then loops: a loop begun from part-way took
    // the whole duration for the rest of the stroke, so the first stroke
    // after every pause was slow and the three fell out of their wander.
    const started = Date.now()
    // The phases as they are for this run of the effect, so the cleanup reads
    // the same ones it started.
    const memories = phases.current
    const running = bars.map((bar, index) => {
      const duration = DURATIONS[index] ?? 900
      const cycle = duration * 2
      const memory = memories[index] ?? { phase: 0, since: null }
      const phase = memory.phase
      memory.since = started
      const stroke = (toValue: number, ms: number): Animated.CompositeAnimation =>
        Animated.timing(bar, {
          toValue,
          duration: ms,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        })
      const rising = phase < duration
      bar.setValue(barAt(phase, duration))
      const animation = Animated.sequence(
        rising
          ? [
              stroke(1, duration - phase),
              Animated.loop(Animated.sequence([stroke(LOW, duration), stroke(1, duration)])),
            ]
          : [
              stroke(LOW, cycle - phase),
              Animated.loop(Animated.sequence([stroke(1, duration), stroke(LOW, duration)])),
            ],
      )
      animation.start()
      return animation
    })
    return () => {
      const stopped = Date.now()
      running.forEach((animation, index) => {
        animation.stop()
        const duration = DURATIONS[index] ?? 900
        const memory = memories[index]
        if (!memory || memory.since === null) return
        memory.phase = (memory.phase + (stopped - memory.since)) % (duration * 2)
        memory.since = null
      })
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
              // Full height, scaled down from its foot: 2 points to `size`, as before.
              height: size,
              transformOrigin: 'bottom',
              transform: [
                { scaleY: bar.interpolate({ inputRange: [0, 1], outputRange: [2 / size, 1] }) },
              ],
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
