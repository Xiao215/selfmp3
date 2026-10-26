import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Easing, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { StyleSheet } from 'react-native-unistyles'
import { space, type } from '@selfmp3/client'
import { claimGuide, guideSeen, markGuideSeen, releaseGuide } from '../guide/guideMemory'
import { nativeDriver } from '../../ports/nativeDriver'
import { useMotionReduced } from '../../ui/motion'
import { TapAway } from '../../ui/components/TapAway'

const NAME = 'sound-map-draw'
/** How long the map has to arrive before the guide comes up. */
const SETTLE_MS = 700
/** One round: a line drawn, then a loop. */
const ROUND_MS = 6400
const TOUCH = 30
const LOOP_R = 56
/** The loop's touch, sampled round the circle. */
const LOOP_STEPS = 16

/**
 * The sound map's one-time guide (E5): a finger's circle, as the app's other
 * guides draw it (`Guide.tsx`), holds still and draws a line between two
 * places, then holds again and goes round a loop, with a line of words for
 * each. Shown once on a device, remembered the moment it appears, and gone at
 * a tap or the first stroke drawn (`done`). Settings › About brings it back
 * with the others.
 */
export function useMapHint(ready: boolean): { shown: boolean; done: () => void } {
  const [shown, setShown] = useState(false)
  // A moment after the map is there, so it arrives before the hand does.
  useEffect(() => {
    if (!ready || guideSeen(NAME)) return undefined
    const timer = setTimeout(() => {
      if (!claimGuide(NAME)) return
      markGuideSeen(NAME)
      setShown(true)
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      releaseGuide(NAME)
    }
  }, [ready])
  return {
    shown,
    done: () => {
      setShown(false)
      releaseGuide(NAME)
    },
  }
}

export function MapHint({
  field,
  onDone,
}: {
  field: { width: number; height: number }
  onDone: () => void
}): ReactNode {
  const reduced = useMotionReduced()
  const [demo] = useState(() => new Animated.Value(reduced ? 0.3 : 0))
  useEffect(() => {
    if (reduced) return undefined
    const round = Animated.loop(
      Animated.timing(demo, {
        toValue: 1,
        duration: ROUND_MS,
        easing: Easing.linear,
        useNativeDriver: nativeDriver,
      }),
    )
    round.start()
    return () => round.stop()
  }, [demo, reduced])

  const cx = field.width / 2
  const cy = field.height / 2
  const from = { x: cx - 80, y: cy + 60 }
  const to = { x: cx + 80, y: cy - 50 }
  const loopAt = (step: number) => {
    const angle = -Math.PI / 2 + (step / LOOP_STEPS) * Math.PI * 2
    return { x: cx + Math.cos(angle) * LOOP_R, y: cy + Math.sin(angle) * LOOP_R }
  }
  const loopTimes = Array.from(
    { length: LOOP_STEPS + 1 },
    (_, step) => 0.62 + (step / LOOP_STEPS) * 0.3,
  )
  const loopPoints = Array.from({ length: LOOP_STEPS + 1 }, (_, step) => loopAt(step))
  const top = loopAt(0)

  // Where the touch is: holding at the line's start, drawing it, then holding
  // at the loop's top and going round.
  const x = demo.interpolate({
    inputRange: [0, 0.14, 0.42, 0.5, ...loopTimes, 1],
    outputRange: [from.x, from.x, to.x, top.x, ...loopPoints.map(point => point.x), top.x],
  })
  const y = demo.interpolate({
    inputRange: [0, 0.14, 0.42, 0.5, ...loopTimes, 1],
    outputRange: [from.y, from.y, to.y, top.y, ...loopPoints.map(point => point.y), top.y],
  })
  const touchSeen = demo.interpolate({
    inputRange: [0, 0.03, 0.42, 0.46, 0.5, 0.53, 0.92, 0.96, 1],
    outputRange: [0, 1, 1, 0, 0, 1, 1, 0, 0],
  })
  // The ring filling under the held touch, before each stroke.
  const holding = { inputRange: [0, 0.04, 0.14, 0.16, 0.53, 0.62, 0.64, 1] }
  const ringSeen = demo.interpolate({ ...holding, outputRange: [0, 0.4, 1, 0, 0.4, 1, 0, 0] })
  // Never quite 0: a transform scaled to nothing cannot be inverted on iOS.
  const ringGrow = demo.interpolate({ ...holding, outputRange: [0.4, 0.4, 1, 1, 0.4, 1, 1, 0.4] })
  const lineSeen = demo.interpolate({
    inputRange: [0, 0.14, 0.2, 0.46, 0.5, 1],
    outputRange: [0, 0, 1, 1, 0, 0],
  })
  const loopSeen = demo.interpolate({
    inputRange: [0, 0.62, 0.68, 0.96, 1],
    outputRange: [0, 0, 1, 1, 0],
  })
  const firstWords = demo.interpolate({ inputRange: [0, 0.46, 0.5, 1], outputRange: [1, 1, 0, 0] })
  const secondWords = demo.interpolate({ inputRange: [0, 0.46, 0.5, 1], outputRange: [0, 0, 1, 1] })

  return (
    <TapAway style={styles.layer} onPress={onDone} testID="sound-map-hint">
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: lineSeen }]}>
        <Svg width={field.width} height={field.height}>
          <Path
            d={`M${from.x},${from.y} C${from.x + 50},${from.y - 10} ${to.x - 60},${to.y + 30} ${to.x},${to.y}`}
            stroke="#ffffff"
            strokeOpacity={0.8}
            strokeWidth={3}
            strokeDasharray="2 7"
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: loopSeen }]}>
        <Svg width={field.width} height={field.height}>
          <Circle
            cx={cx}
            cy={cy}
            r={LOOP_R}
            stroke="#ffffff"
            strokeOpacity={0.8}
            strokeWidth={3}
            strokeDasharray="2 7"
            strokeLinecap="round"
            fill="#ffffff"
            fillOpacity={0.06}
          />
        </Svg>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.touchAt,
          { opacity: touchSeen, transform: [{ translateX: x }, { translateY: y }] },
        ]}
      >
        <Animated.View
          style={[styles.ring, { opacity: ringSeen, transform: [{ scale: ringGrow }] }]}
        />
        <View style={styles.touch} />
      </Animated.View>
      <View pointerEvents="none" style={styles.words}>
        <Animated.Text style={[styles.line, { opacity: firstWords }]}>
          Hold, then drag: a line drifts from place to place
        </Animated.Text>
        <Animated.Text style={[styles.line, styles.second, { opacity: secondWords }]}>
          Go round: a loop takes the songs inside
        </Animated.Text>
        <Text style={styles.close}>Tap to start</Text>
      </View>
    </TapAway>
  )
}

const RING = 46

const styles = StyleSheet.create(() => ({
  layer: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4, 5, 11, 0.42)' },
  touchAt: { position: 'absolute', left: -TOUCH / 2, top: -TOUCH / 2, width: TOUCH, height: TOUCH },
  touch: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
  },
  ring: {
    position: 'absolute',
    left: (TOUCH - RING) / 2,
    top: (TOUCH - RING) / 2,
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  words: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: '22%',
    alignItems: 'center',
    gap: space.xs,
  },
  line: {
    fontSize: type.body,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowRadius: 8,
  },
  second: { position: 'absolute', top: 0, left: 0, right: 0 },
  close: { fontSize: type.small, color: 'rgba(255, 255, 255, 0.74)', marginTop: space.lg },
}))
