import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * Whether this device asks for less motion: the iOS setting on a phone, and
 * `prefers-reduced-motion` in a browser, which react-native-web answers from
 * the same call. The visuals then draw one still frame per song.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      alive = false
      subscription.remove()
    }
  }, [])
  return reduced
}
