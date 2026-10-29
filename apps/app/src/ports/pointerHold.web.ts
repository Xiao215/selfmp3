import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { View } from 'react-native'
import type { PointerHold } from './pointerHold'

/**
 * Holding a row with a pointer, in the browser's own terms.
 *
 * Neither gesture handler nor a pan responder can do this one. Gesture
 * handler's web build recognises the first hold of a page and then never
 * activates again (reproduced at 1280 and not at 390, with the song drag off
 * and every row undraggable, so it is the recogniser). A pan responder is
 * never offered the move: the row's own `Pressable` is the responder by then,
 * and React Native Web does not run the negotiation again for a mouse.
 *
 * The browser has a mechanism made for exactly this. `setPointerCapture`
 * sends every later move to one element whatever the pointer is over, so a
 * row keeps the drag while the list rearranges underneath it, and a capture
 * is released the moment the button comes up. Nothing is captured until the
 * hold has elapsed, so a click still plays the song and a drag before then
 * still scrolls the page.
 */
export function usePointerHold(ref: RefObject<View | null>, hold: PointerHold): void {
  // The callbacks as they are now, so the listeners are attached once and a
  // render in the middle of a drag does not drop them.
  const latest = useRef(hold)
  useEffect(() => {
    latest.current = hold
  })

  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node || !hold.enabled) return undefined

    let timer: ReturnType<typeof setTimeout> | null = null
    let lifted = false
    let fromX = 0
    let fromY = 0
    let travelled = 0

    const forget = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      document.removeEventListener('pointerup', abandon, true)
      document.removeEventListener('pointercancel', abandon, true)
    }

    /*
     * The count let go of somewhere else. Until the hold lifts, nothing is
     * captured, so the button can come up — or the browser's own drag can
     * take the pointer, cancelling it on whatever row it is over by then —
     * away from this row, which hears nothing. The count ran on, and lifted
     * the row after it had been dropped, following a pointer with no button
     * held. So the document listens while it counts, and a drag starting
     * ends it too.
     */
    const abandon = (event: Event): void => {
      if (timer === null) return
      // On the row itself, its own `up` and `cancel` answer it.
      if (event.type !== 'dragstart' && event.target instanceof Node && node.contains(event.target))
        return
      forget()
      latest.current.onHolding?.(false)
    }

    const down = (event: PointerEvent): void => {
      // The primary button only: a right-click is the menu's.
      if (event.button !== 0) return
      fromX = event.clientX
      fromY = event.clientY
      travelled = 0
      forget()
      // The count has begun, so the row can say so while it runs.
      latest.current.onHolding?.(true)
      document.addEventListener('pointerup', abandon, true)
      document.addEventListener('pointercancel', abandon, true)
      timer = setTimeout(() => {
        forget()
        lifted = true
        // Every later move comes here, whatever it is over.
        node.setPointerCapture(event.pointerId)
        latest.current.onStart(event.clientX)
      }, latest.current.holdMs)
    }

    const move = (event: PointerEvent): void => {
      if (!lifted) return
      travelled = Math.abs(event.clientX - fromX) + Math.abs(event.clientY - fromY)
      latest.current.onMove(event.clientX - fromX, event.clientY - fromY)
    }

    const up = (event: PointerEvent): void => {
      forget()
      // Before the early return: a press that let go before the hold won is
      // exactly the one whose swell has to be taken back.
      latest.current.onHolding?.(false)
      if (!lifted) return
      lifted = false
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId)
      latest.current.onEnd(event.clientX - fromX, event.clientY - fromY)
    }

    const cancel = (): void => {
      forget()
      latest.current.onHolding?.(false)
      if (!lifted) return
      lifted = false
      // Taken away: the row goes back where it began.
      latest.current.onEnd(0, 0)
    }

    /*
     * A drag ends in a click, and the click would play the song. Swallowed on
     * the way down, and only when the pointer actually travelled: a hold that
     * lifted a row and put it straight back still counts as a press.
     */
    const click = (event: MouseEvent): void => {
      if (Math.abs(travelled) < 4) return
      travelled = 0
      event.preventDefault()
      event.stopPropagation()
    }

    node.addEventListener('pointerdown', down)
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', cancel)
    node.addEventListener('dragstart', abandon)
    node.addEventListener('click', click, true)
    return () => {
      // Let go of mid-hold — the row unmounted, or moving was switched off —
      // the hold ends as if taken away, or nothing would ever say so: the row
      // stays swollen, and `setReorderHold` keeps every row undraggable.
      if (timer !== null) latest.current.onHolding?.(false)
      forget()
      if (lifted) {
        lifted = false
        latest.current.onEnd(0, 0)
      }
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', cancel)
      node.removeEventListener('dragstart', abandon)
      node.removeEventListener('click', click, true)
    }
  }, [ref, hold.enabled])
}
