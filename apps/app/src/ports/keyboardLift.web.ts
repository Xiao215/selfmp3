import { useSharedValue, type SharedValue } from 'react-native-reanimated'

/*
 * A browser has no keyboard event to follow: it moves the page itself, and a
 * computer's keyboard is not on the screen. Nothing lifts.
 */

export function useKeyboardHeight(): SharedValue<number> {
  return useSharedValue(0)
}

export function useKeyboardMoving(_active: boolean): () => boolean {
  return keyboardNeverMoving
}

function keyboardNeverMoving(): boolean {
  return false
}
