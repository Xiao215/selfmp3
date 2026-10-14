import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, type StyleProp, type ViewStyle } from 'react-native'
import { Easing, FadeInDown, ZoomIn } from 'react-native-reanimated'
import { motion } from '@selfmp3/client'
import { EASE_OUT_POINTS, MOVE_MS, STAGGER_MS } from '../../ui/motion.model'
import { ease, nativeDriver, timing, useMotionReduced } from '../../ui/motion'

/** How long a face's ring takes to spread and fade as they arrive. */
const RING_MS = 900

/** How long the live ring takes to spread and fade, before the next one starts. */
const LIVE_MS = 2000

/**
 * How a room arrives (M1 + M2, Xiao 2026-10-14), as Reanimated's entering
 * animations, which a browser runs too.
 *
 * - `face(i)`: a face springing into its seat — yours as the room opens,
 *   a friend's as they join.
 * - `letter(i)`: the room's code rolling in a letter at a time.
 * - `rise(i)`: the rest of the room's sheet rising in after the code.
 *
 * Nothing at all under Reduce Motion: what arrives is simply there. The ring
 * round a friend who just came is `ArrivalRing`.
 */
export interface RoomMoves {
  readonly face: (order: number) => ZoomIn
  readonly letter: (order: number) => FadeInDown
  readonly rise: (order: number) => FadeInDown
}

export function useRoomMoves(): RoomMoves | null {
  const reduced = useMotionReduced()
  return useMemo(() => {
    if (reduced) return null
    const out = Easing.bezier(...EASE_OUT_POINTS)
    return {
      face: order =>
        ZoomIn.springify()
          .stiffness(motion.spring.stiffness * 1.4)
          .damping(motion.spring.damping * 0.6)
          .mass(1)
          .delay(order * STAGGER_MS),
      // The presets as they are: a browser leaves an entering animation with
      // its own start values pinned where it ended (position: absolute), and
      // the next change to the sheet's layout leaves it behind.
      letter: order =>
        FadeInDown.duration(MOVE_MS.rowIn)
          .easing(out)
          .delay(MOVE_MS.room + order * 40),
      rise: order =>
        FadeInDown.duration(MOVE_MS.arrive)
          .easing(out)
          .delay(MOVE_MS.room + 200 + order * STAGGER_MS),
    }
  }, [reduced])
}

/**
 * The ring in a friend's colour spreading out from their face as they come
 * in (M2), once, as it mounts. React Native's own `Animated` rather than a
 * Reanimated keyframe, which a browser leaves pinned where it ended.
 */
export function ArrivalRing({ style }: { style: StyleProp<ViewStyle> }): ReactNode {
  const reduced = useMotionReduced()
  const [spread] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!reduced) timing(spread, 1, RING_MS, undefined, { easing: ease.out })
  }, [reduced, spread])
  if (reduced) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          opacity: spread.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          transform: [{ scale: spread.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        },
      ]}
    />
  )
}

/**
 * The arrival ring again and again (L1, Xiao 2026-10-14): the room button
 * while you are in a room, a ring spreading out from it every two seconds,
 * so a room reads as live wherever it shows. Under Reduce Motion there is
 * no ring, and the button's accent edge says it alone.
 */
export function LiveRing({ style }: { style: StyleProp<ViewStyle> }): ReactNode {
  const reduced = useMotionReduced()
  const [spread] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (reduced) return undefined
    const loop = Animated.loop(
      Animated.timing(spread, {
        toValue: 1,
        duration: LIVE_MS,
        easing: ease.out,
        useNativeDriver: nativeDriver,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [reduced, spread])
  if (reduced) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          opacity: spread.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
          transform: [{ scale: spread.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
        },
      ]}
    />
  )
}
