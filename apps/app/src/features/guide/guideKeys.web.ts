import { useEffect, type RefObject } from 'react'
import type { View } from 'react-native'

/**
 * Keeps the keys with a guide while it is up. Tab walked on past the dark
 * layer into the sidebar under it, and Enter opened a page with the guide
 * still drawn over it. So the guide takes the focus as it comes, Tab leaves it
 * there, and any other key pressed somewhere else brings the focus back
 * without reaching the page. Enter and Space on the guide are its own press;
 * Escape is its layer's (`useEscape`). Focus goes back where it was once the
 * guide is closed.
 *
 * The page's own keys stand aside too, since the focus is now in a dialog
 * (`focusOwnsKey`).
 */
export function useGuideKeys(active: boolean, press: RefObject<View | null>): void {
  useEffect(() => {
    if (!active) return undefined
    const guide = (): HTMLElement | null => press.current as unknown as HTMLElement | null
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const take = (): void => guide()?.focus({ preventScroll: true })
    // The guide is drawn at the root a render after it is asked for: its view
    // may not be there yet.
    const frame = requestAnimationFrame(take)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') return
      const node = guide()
      const inside = node !== null && event.target instanceof Node && node.contains(event.target)
      if (event.key === 'Tab' || !inside) {
        event.preventDefault()
        event.stopPropagation()
        take()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown, true)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [active, press])
}
