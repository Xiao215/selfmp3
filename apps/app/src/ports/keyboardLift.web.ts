import { useState } from 'react'
import { Animated } from 'react-native'

/**
 * A browser has no keyboard event to follow: it moves the page itself, and a
 * computer's keyboard is not on the screen. Nothing lifts.
 */
export function useKeyboardLift(_active: boolean): { height: number; lift: Animated.Value } {
  const [lift] = useState(() => new Animated.Value(0))
  return { height: 0, lift }
}
