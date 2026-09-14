import { useEffect, useRef } from 'react'
import { menuOwnedCombinations } from '@selfmp3/desktop-bridge'

import type { Hotkeys } from './useHotkeys'
import { desktop } from '../ports/desktop/bridge'

export type { Hotkeys }

/**
 * Combinations the desktop's application menu has taken.
 *
 * macOS runs a menu accelerator *and* still delivers the keydown to the page,
 * so without this ⌘K would open the palette twice — once from the menu's
 * command and once from here. Empty in a browser, where there is no menu.
 *
 * Computed once: the menu is built from a constant.
 */
const menuOwned: ReadonlySet<string> = desktop ? menuOwnedCombinations() : new Set<string>()

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
      const combination = parts.join('+')
      if (menuOwned.has(combination)) return
      const handler = latest.current[combination]
      if (handler) {
        event.preventDefault()
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
