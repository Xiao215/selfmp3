import { useState, useSyncExternalStore } from 'react'
import { AccessibilityInfo, Animated } from 'react-native'
import { motion } from '@selfmp3/client'

/**
 * Every move in the app goes through here (docs/ui-mock `M1`, and
 * docs/UI-MIGRATION.md, Phase 9), so that Reduce Motion is answered once and no
 * screen can forget it: under it a spring or a fade lands where it was going
 * with no time in between.
 */

let reduced = false
const listeners = new Set<() => void>()

// One subscription for the whole app, not one per button: a library of rows
// each asking the platform the same question was a listener per row.
void AccessibilityInfo.isReduceMotionEnabled().then(value => {
  reduced = value
  for (const listener of listeners) listener()
})
AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
  reduced = value
  for (const listener of listeners) listener()
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether moves are instant right now, for code outside React. */
function motionReduced(): boolean {
  return reduced
}

/**
 * Whether this device asks for less motion: Reduce Motion on an iPhone or a
 * Mac, `prefers-reduced-motion` in a browser. False until the answer arrives,
 * a frame or two after launch.
 */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, motionReduced)
}

/**
 * The native driver, as the rest of the app asks for it: a browser has none
 * and react-native-web runs the same animation on the JS side instead.
 */
const nativeDriver = true

/**
 * The one spring (`motion.spring`), or a jump to the end under Reduce Motion.
 * Returns what was started, so a caller can chain or stop it.
 */
export function spring(value: Animated.Value, toValue: number): Animated.CompositeAnimation | null {
  if (reduced) {
    value.setValue(toValue)
    return null
  }
  const animation = Animated.spring(value, {
    toValue,
    stiffness: motion.spring.stiffness,
    damping: motion.spring.damping,
    mass: 1,
    useNativeDriver: nativeDriver,
  })
  animation.start()
  return animation
}

/**
 * A timed move, or a jump to the end under Reduce Motion. `onDone` runs when
 * it lands — at once, when there is no move — and not if it is interrupted.
 */
export function timing(
  value: Animated.Value,
  toValue: number,
  duration: number,
  onDone?: () => void,
): Animated.CompositeAnimation | null {
  if (reduced) {
    value.setValue(toValue)
    onDone?.()
    return null
  }
  const animation = Animated.timing(value, { toValue, duration, useNativeDriver: nativeDriver })
  animation.start(({ finished }) => {
    if (finished) onDone?.()
  })
  return animation
}

/** How far a pressed thing sinks (`M1`, "Press"). */
const PRESS_SCALE = 0.96

/**
 * Everything pressable sinks to 0.96 on the spring and comes back on release.
 * Spread `handlers` onto the Pressable and put `style` on an `Animated.View`
 * around it (a Pressable's style function cannot carry an animated value).
 */
export function usePressScale(to: number = PRESS_SCALE): {
  style: { transform: { scale: Animated.Value }[] }
  handlers: { onPressIn: () => void; onPressOut: () => void }
} {
  // Made once per component, in state rather than a ref, so render reads nothing mutable.
  const [press] = useState(() => {
    const scale = new Animated.Value(1)
    return {
      style: { transform: [{ scale }] },
      handlers: {
        onPressIn: () => void spring(scale, to),
        onPressOut: () => void spring(scale, 1),
      },
    }
  })
  return press
}
