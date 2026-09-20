import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { ScrollView } from 'react-native'

/**
 * Dragging a sideways list along with a mouse.
 *
 * A finger flicks the row of recents or the tag strip; a mouse could only
 * reach the part already on screen, because a browser scrolls sideways on a
 * wheel it may not have. Press and drag now moves it, as it does on a map.
 *
 * The press only becomes a drag past a few pixels, so a click on a cover is
 * still a click, and that cover's own press is cancelled from there on.
 */
const DRAG_FROM = 5

export function useDragScroll(): { ref: RefObject<ScrollView | null> } {
  const ref = useRef<ScrollView | null>(null)

  useEffect(() => {
    const view = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    const node = view?.getScrollableNode?.()
    if (!node) return undefined

    let from: { x: number; left: number } | null = null
    let dragging = false

    const down = (event: PointerEvent): void => {
      // The left button of a mouse or a trackpad only: a finger has its own.
      if (event.pointerType === 'touch' || event.button !== 0) return
      from = { x: event.clientX, left: node.scrollLeft }
    }
    const move = (event: PointerEvent): void => {
      if (!from) return
      const travelled = from.x - event.clientX
      if (!dragging && Math.abs(travelled) < DRAG_FROM) return
      if (!dragging) {
        dragging = true
        node.style.cursor = 'grabbing'
        node.setPointerCapture(event.pointerId)
      }
      node.scrollLeft = from.left + travelled
      event.preventDefault()
    }
    const up = (): void => {
      from = null
      if (!dragging) return
      dragging = false
      node.style.cursor = ''
    }
    // A drag that ended over a cover must not also press it.
    const click = (event: MouseEvent): void => {
      if (dragging) event.stopPropagation()
    }

    node.addEventListener('pointerdown', down)
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', up)
    node.addEventListener('click', click, true)
    return () => {
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', up)
      node.removeEventListener('click', click, true)
    }
  }, [])

  return { ref }
}
