import type { View } from 'react-native'

/**
 * What a popover hangs off: a view, measured where it stands, or a point.
 *
 * `measureInWindow` is all a popover asks of its anchor, so a right-click's
 * point can stand in for the ⋯ it would otherwise have opened from.
 */
export type PopoverAnchor = Pick<View, 'measureInWindow'>

/**
 * A point in the window, as an anchor with no size: a menu opened by
 * right-clicking opens at the pointer, not beside the row's ⋯ (proposal B1,
 * 2026-10-08). A cover flying to Up next from it finds nothing to fly from,
 * which is right — there was no button pressed.
 */
function pointAnchor(x: number, y: number): PopoverAnchor {
  return { measureInWindow: callback => callback(x, y, 0, 0) }
}

interface ContextMenuEvent {
  preventDefault: () => void
  nativeEvent: { clientX: number; clientY: number }
}

/**
 * Props that make a right-click on a view open `open` at the pointer, in a
 * browser and the Mac app; the browser's own menu is kept away. Spread onto
 * the view: react-native-web passes `onContextMenu` through to the element,
 * and a phone has no right-click to send it. Nothing when there is nothing to
 * open, so the browser's menu is left alone there.
 */
export function rightClick(open: ((at: PopoverAnchor) => void) | undefined): {
  onContextMenu?: (event: ContextMenuEvent) => void
} {
  if (!open) return {}
  return {
    onContextMenu: event => {
      event.preventDefault()
      open(pointAnchor(event.nativeEvent.clientX, event.nativeEvent.clientY))
    },
  }
}
