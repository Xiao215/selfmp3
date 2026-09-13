import { useEffect, useRef } from 'react'

import type { Hotkeys } from './useHotkeys'

export type { Hotkeys }

/**
 * Keyboard shortcuts on the web: the web app's `useHotkeys`.
 *
 * Never while someone is typing, or while a dropdown, menu or dialog has the
 * keyboard: those run their own keys. Escape is left to `useEscape`, which
 * knows which layer is on top.
 */
export function useHotkeys(hotkeys: Hotkeys): void {
  const latest = useRef(hotkeys)
  useEffect(() => {
    latest.current = hotkeys
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable ||
          target.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]') !==
            null
        ) {
          return
        }
      }
      const parts: string[] = []
      if (event.metaKey) parts.push('meta')
      if (event.ctrlKey) parts.push('ctrl')
      if (event.altKey) parts.push('alt')
      if (event.shiftKey && event.key.length > 1) parts.push('shift')
      parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key)
      const handler = latest.current[parts.join('+')]
      if (handler) {
        event.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
