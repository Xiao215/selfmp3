import { useEffect, useEffectEvent, type RefObject } from 'react'
import type { View, ViewStyle } from 'react-native'
import type { FieldWheel } from './fieldInput'

export type { FieldWheel } from './fieldInput'

/** A crosshair: a drag over the map draws a path. React Native's types leave the value out. */
export const DRAWING_CURSOR = { cursor: 'crosshair' } as unknown as ViewStyle

/** A wheel's lines and pages, in points, as a browser scrolls them. */
const LINE = 16
const PAGE = 400

/**
 * The browser's wheel over the field, which moves the map — a trackpad's two
 * fingers, a mouse's wheel — and zooms it for a trackpad pinch (which the
 * browser sends as a wheel with Ctrl held) or with ⌘ or Ctrl held. Listened
 * to directly, not passively, so the page does not scroll or zoom as well.
 */
export function useFieldWheel(
  ref: RefObject<View | null>,
  onWheel: (wheel: FieldWheel) => void,
): void {
  const handle = useEffectEvent(onWheel)
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return
    const listener = (event: WheelEvent): void => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1
      const rect = node.getBoundingClientRect()
      handle({
        dx: event.deltaX * unit,
        dy: event.deltaY * unit,
        // A browser sends a trackpad pinch as a wheel with Ctrl held.
        zoom: event.metaKey ? 'wheel' : event.ctrlKey ? 'pinch' : null,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      })
    }
    node.addEventListener('wheel', listener, { passive: false })
    return () => node.removeEventListener('wheel', listener)
  }, [ref])
}
