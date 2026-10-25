import { useEffect } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- only to ask which field has the keys, never to draw one
import { Keyboard, TextInput } from 'react-native'
import type { GestureResponderEvent, ViewProps } from 'react-native'
import { fingersLeft } from './guide.model'
import { setFingers, setTyping } from './guideBusy'

/**
 * What tells the guides the hands are busy (`guideBusy`), spread on the app's
 * root view: every touch passes through it on its way up, whoever answers it.
 * The keyboard being up stands for typing. A touch a gesture handler takes
 * over is cancelled here while the finger is still down, so a hold to move
 * says so itself (`HoldToReorder`).
 *
 * The web twin listens to the window instead (`watchBusy.web.ts`).
 */
export function useWatchBusy(): Partial<ViewProps> {
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setTyping(true))
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  return HANDLERS
}

const ended = (event: GestureResponderEvent): void => {
  const { touches, changedTouches } = event.nativeEvent
  setFingers(fingersLeft(touches, changedTouches))
}

const HANDLERS: Partial<ViewProps> = {
  onTouchStart: event => setFingers(event.nativeEvent.touches.length),
  onTouchEnd: ended,
  onTouchCancel: ended,
}

/**
 * Whether a field has the keys right now: an iPad's hardware keyboard types
 * with no keyboard on screen to say so.
 */
export function fieldFocused(): boolean {
  // Nothing focused is null on a phone and undefined in a test renderer.
  return Boolean(TextInput.State.currentlyFocusedInput())
}
