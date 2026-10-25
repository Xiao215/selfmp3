import { useMemo, useRef } from 'react'
import type { GestureResponderEvent } from 'react-native'

/** How far a finger may wander and still have tapped: past it, it was a swipe or a drag. */
export const TAP_SLOP = 10

/** Whether a touch that went from `from` to `to` is still a tap. */
export function stillATap(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= TAP_SLOP
}

/**
 * How far the finger on a view has gone, for a press that sits under a swipe.
 *
 * A press is only cancelled by a gesture that takes the touch, and a swipe
 * that never took it — a sideways drag the row's recogniser failed on, a
 * cover swiped across — let go as a tap: the song under it played, and Up
 * next lost its place. Spread `handlers` on a view round the press and ask
 * `moved()` in its `onPress`. Touches only, which every platform sends to the
 * views a finger is in whoever holds it; a mouse's drag has its own guard
 * (`useSwallowSwipeClick`).
 */
export function useTouchTravel(): {
  readonly handlers: {
    readonly onTouchStart: (event: GestureResponderEvent) => void
    readonly onTouchMove: (event: GestureResponderEvent) => void
  }
  readonly moved: () => boolean
} {
  const touch = useRef({ from: { x: 0, y: 0 }, still: true })
  return useMemo(
    () => ({
      handlers: {
        onTouchStart: event => {
          const { pageX, pageY } = event.nativeEvent
          touch.current = { from: { x: pageX, y: pageY }, still: true }
        },
        onTouchMove: event => {
          const { pageX, pageY } = event.nativeEvent
          if (!stillATap(touch.current.from, { x: pageX, y: pageY })) touch.current.still = false
        },
      },
      moved: () => !touch.current.still,
    }),
    [],
  )
}
