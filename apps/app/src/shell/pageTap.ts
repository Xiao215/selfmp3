import { useRef, type RefObject } from 'react'
import type { GestureResponderEvent, View, ViewProps } from 'react-native'

/** How far a finger may wander, and how long it may stay, for a touch to count as a tap. */
const TAP_SLOP = 10
const TAP_MS = 350

/**
 * A tap anywhere on the page, heard without taking it: the touch still reaches
 * the row or button under it. For what lies over the page and goes when the
 * page is touched (Up next over an iPad's page). Only a short touch that stays
 * put counts, so holding a song to drag it into the rail does not close it.
 *
 * The web twin listens for the browser's click instead (`pageTap.web.ts`).
 */
export function usePageTap(
  _page: RefObject<View | null>,
  active: boolean,
  onTap: () => void,
): Partial<ViewProps> {
  const start = useRef<{ x: number; y: number; at: number } | null>(null)
  return active
    ? {
        onTouchStart: (event: GestureResponderEvent) => {
          const { pageX, pageY } = event.nativeEvent
          start.current = { x: pageX, y: pageY, at: Date.now() }
        },
        onTouchEnd: (event: GestureResponderEvent) => {
          const from = start.current
          start.current = null
          if (!from) return
          const { pageX, pageY } = event.nativeEvent
          const still = Math.hypot(pageX - from.x, pageY - from.y) < TAP_SLOP
          if (still && Date.now() - from.at < TAP_MS) onTap()
        },
      }
    : {}
}
