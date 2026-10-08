import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useAccentColor } from '../accent'
import { nativeDriver } from '../motion'

/**
 * The three bars that say a song is playing.
 *
 * Each bar has its own looping Animated value and its own duration — 0.9s,
 * 0.7s and 1.1s — so they drift out of step and never look mechanical.
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
  // The accent only when no colour is given: a playing row always gives its
  // own, and then the accent picker has nothing to say to it.
  const accent = useAccentColor(color === undefined)
  const barColor = color ?? accent
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
    //
    // The loops carry on from where the last stroke ended. Left to its
    // default, `Animated.loop` puts the value back to the one it was made with
    // (`LOW`) before every cycle, so a bar that had just risen to the top
    // dropped to the bottom in one frame and sat there for a whole stroke —
    // every bar, every second or two, since a bar starts out rising.
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
          useNativeDriver: nativeDriver,
        })
      const rising = phase < duration
      bar.setValue(barAt(phase, duration))
      const animation = Animated.sequence(
        rising
          ? [
              stroke(1, duration - phase),
              Animated.loop(Animated.sequence([stroke(LOW, duration), stroke(1, duration)]), {
                resetBeforeIteration: false,
              }),
            ]
          : [
              stroke(LOW, cycle - phase),
              Animated.loop(Animated.sequence([stroke(1, duration), stroke(LOW, duration)]), {
                resetBeforeIteration: false,
              }),
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

  // Full height, scaled down from its foot: 2 points to `size`. Built once per
  // size, not per render: an interpolation made in the render is a new node
  // handed to the native driver every time the row around it re-renders.
  const shapes = useMemo(
    () =>
      bars.map(bar => ({
        height: size,
        transformOrigin: 'bottom',
        transform: [
          { scaleY: bar.interpolate({ inputRange: [0, 1], outputRange: [2 / size, 1] }) },
        ],
      })),
    [bars, size],
  )

  return (
    <View style={[styles.row, { height: size }]}>
      {shapes.map((shape, index) => (
        <Animated.View key={index} style={[styles.bar, shape, { backgroundColor: barColor }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { width: 2.5, borderRadius: 1.5 },
})
