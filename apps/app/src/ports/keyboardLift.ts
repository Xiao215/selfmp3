import { useEffect, useState } from 'react'
import { Animated, Keyboard, Platform, type KeyboardEvent } from 'react-native'
import { timing } from '../ui/motion'

/**
 * How far the on-screen keyboard reaches up the window, and a value that
 * follows it on the keyboard's own clock — for a panel pinned to the foot of
 * the screen, which the keyboard would otherwise cover.
 *
 * A sheet's search field is near its top and its rows are under it: with the
 * keyboard up and nothing moving, the tag picker showed one row and hid the
 * rest, so a tag further down the list could not be reached to untick it
 * (Xiao, 2026-10-07). `lift` is negative, ready for a `translateY`.
 *
 * Only while `active`, so a closed sheet is not listening. The web's twin is
 * `keyboardLift.web.ts`, where nothing lifts.
 */
export function useKeyboardLift(active: boolean): { height: number; lift: Animated.Value } {
  const [height, setHeight] = useState(0)
  const [lift] = useState(() => new Animated.Value(0))

  useEffect(() => {
    if (!active) return undefined
    // iOS says beforehand, so the panel moves with the keyboard; Android only after.
    const ios = Platform.OS === 'ios'
    const follow = (to: number, event?: KeyboardEvent): void => {
      setHeight(to)
      timing(lift, -to, event?.duration || 250)
    }
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', event =>
      follow(event.endCoordinates.height, event),
    )
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', event =>
      follow(0, event),
    )
    // A keyboard already up when the panel opened, as one opened from a field.
    const metrics = Keyboard.metrics()
    if (metrics && Keyboard.isVisible()) follow(metrics.height)
    return () => {
      shown.remove()
      hidden.remove()
      setHeight(0)
      lift.setValue(0)
    }
  }, [active, lift])

  return { height, lift }
}
