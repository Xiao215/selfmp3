import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import {
  KeyboardState,
  useAnimatedKeyboard,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated'

/**
 * How far the on-screen keyboard reaches up the window, read on the UI thread
 * frame by frame as it moves — for a panel pinned to the foot of the screen,
 * which the keyboard would otherwise cover.
 *
 * A sheet's search field is near its top and its rows are under it: with the
 * keyboard up and nothing moving, the tag picker would show one row and hide
 * the rest, so a tag further down the list could not be reached to untick it.
 *
 * Read from the keyboard's own frames rather than eased towards its end on a
 * curve of ours: a panel moved by a timing of the same length still parted
 * from the keyboard's edge on the way, as no curve we have is the keyboard's.
 *
 * Listens from the moment it is called, so only something mounted while it is
 * needed should call it: a sheet's panel, not every closed sheet. The web's
 * twin is `keyboardLift.web.ts`, where nothing lifts.
 */
export function useKeyboardHeight(): SharedValue<number> {
  // A keyboard already up when the panel opened, as one opened from a field:
  // no event says so until it next moves.
  const [already] = useState(() => (Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0))
  const keyboard = useAnimatedKeyboard()
  return useDerivedValue(() =>
    keyboard.state.value === KeyboardState.UNKNOWN ? already : keyboard.height.value,
  )
}

/**
 * Whether the keyboard is up or on its way up or down, for a panel to ask when
 * its height changes: the keyboard is what changed it, and there is nothing of
 * its own to ease. From the moment the keyboard sets off — iOS says
 * beforehand, Android only after — until it has gone, so its last frames on
 * the way down still count.
 *
 * Only while `active`, so a closed sheet is not listening.
 */
export function useKeyboardMoving(active: boolean): () => boolean {
  const up = useRef(false)
  useEffect(() => {
    if (!active) return undefined
    up.current = Keyboard.isVisible()
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        up.current = true
      },
    )
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      up.current = false
    })
    return () => {
      shown.remove()
      hidden.remove()
      up.current = false
    }
  }, [active])
  return useCallback(() => up.current, [])
}
