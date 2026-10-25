import { useEffect } from 'react'
import type { ViewProps } from 'react-native'
import { takesTyping } from './guide.model'
import { holdGuides, setFingers, setTyping } from './guideBusy'

/**
 * The web's way of telling the guides the hands are busy (`watchBusy.ts`):
 * pointers down anywhere in the window, a mouse's buttons and a finger alike,
 * a song carried by the browser's drag, and focus in a field.
 */
export function useWatchBusy(): Partial<ViewProps> {
  useEffect(() => {
    const down = new Set<number>()
    const press = (event: PointerEvent): void => {
      down.add(event.pointerId)
      setFingers(down.size)
    }
    const release = (event: PointerEvent): void => {
      down.delete(event.pointerId)
      setFingers(down.size)
    }
    // A button let go outside the window is never heard: leaving the window
    // starts again from nothing down.
    const away = (): void => {
      down.clear()
      setFingers(0)
    }
    // A song carried by the browser's own drag: the browser cancels the
    // pointer as the drag begins, with the button still down.
    const dragging = (): void => holdGuides('browser-drag', true)
    const dropped = (): void => holdGuides('browser-drag', false)
    const focusIn = (event: FocusEvent): void => setTyping(takesTyping(asElement(event.target)))
    const focusOut = (event: FocusEvent): void =>
      setTyping(takesTyping(asElement(event.relatedTarget)))
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', away)
    window.addEventListener('dragstart', dragging, true)
    window.addEventListener('dragend', dropped, true)
    window.addEventListener('drop', dropped, true)
    document.addEventListener('focusin', focusIn)
    document.addEventListener('focusout', focusOut)
    setTyping(fieldFocused())
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', away)
      window.removeEventListener('dragstart', dragging, true)
      window.removeEventListener('dragend', dropped, true)
      window.removeEventListener('drop', dropped, true)
      document.removeEventListener('focusin', focusIn)
      document.removeEventListener('focusout', focusOut)
    }
  }, [])
  return {}
}

function asElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null
}

export function fieldFocused(): boolean {
  return takesTyping(asElement(document.activeElement))
}
