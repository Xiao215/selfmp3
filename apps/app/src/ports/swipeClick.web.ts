import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { View } from 'react-native'

/** How long after a swipe's last move a click inside it is still the swipe's. */
const SWIPE_CLICK_MS = 300

/** When the swipe last moved; a method rather than a field, so a gesture's callback can set it. */
class SwipeClock {
  at = 0
  readonly mark = (): void => {
    this.at = Date.now()
  }
}

/**
 * Dropping the click that ends a swipe with a *pointer*. Hands back what the
 * swipe calls as it moves.
 *
 * A mouse let go after dragging a row sideways is also a click on whatever the
 * row put under it — the row, which played the song being swiped away, or a
 * tag chip on it, which opened the tag and closed Up next — because the row
 * moved with the pointer and the button came up over the element it went down
 * on. Gesture handler cancels those presses on a phone; a browser sends the
 * click anyway.
 *
 * Stopped while it is still on its way down, in the capture phase: React hears
 * clicks at the root as they bubble back up, so a click stopped here never
 * reaches any press inside the row.
 */
export function useSwallowSwipeClick(ref: RefObject<View | null>): () => void {
  const [clock] = useState(() => new SwipeClock())
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null
    if (!node) return undefined
    const click = (event: MouseEvent): void => {
      if (Date.now() - clock.at > SWIPE_CLICK_MS) return
      event.stopPropagation()
      event.preventDefault()
    }
    node.addEventListener('click', click, true)
    return () => node.removeEventListener('click', click, true)
  }, [ref, clock])
  return clock.mark
}
