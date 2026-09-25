import { useEffect, useRef } from 'react'
import { menuOwnedCombinations } from '@selfmp3/desktop-bridge'

import type { HotkeyOptions, Hotkeys } from './useHotkeys'
import { isComposing } from './composing'
import { desktop } from '../ports/desktop/bridge'

export type { HotkeyOptions, Hotkeys }

/**
 * Combinations the desktop's application menu has taken.
 *
 * macOS runs a menu accelerator *and* still delivers the keydown to the page,
 * so without this a screen that also answered one of the menu's keys would
 * run twice — once from the menu's command and once from here. Empty in a
 * browser, where there is no menu.
 *
 * Computed once: the menu is built from a constant.
 */
const menuOwned: ReadonlySet<string> = desktop ? menuOwnedCombinations() : new Set<string>()

/**
 * A screen's own keys on the web: the web app's `useHotkeys`.
 *
 * The page registers no app-wide shortcut here — see `useHotkeys.ts`. A tab's
 * ⌘K belongs to the browser; the installed app's menu keys arrive through
 * `useCommands`, which is the one caller that binds keys beyond a screen.
 *
 * Never while someone is typing, or while a dropdown, menu or dialog has the
 * keyboard: those run their own keys. Escape is left to `useEscape`, which
 * knows which layer is on top.
 */
export function useHotkeys(hotkeys: Hotkeys, { beforeFocused = false }: HotkeyOptions = {}): void {
  const latest = useRef(hotkeys)
  useEffect(() => {
    latest.current = hotkeys
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isComposing(event)) return
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
        // Kept from the focused element too: react-native-web's buttons take
        // Space and Enter for themselves and stop them bubbling, so a listener
        // on the way back up never heard them.
        if (beforeFocused) event.stopPropagation()
        // A held key repeats. Holding Space flipped between play and pause as
        // fast as the keyboard repeats, so these answer the press, not the hold.
        if (beforeFocused && event.repeat) return
        handler()
      }
    }
    window.addEventListener('keydown', onKeyDown, beforeFocused)
    return () => window.removeEventListener('keydown', onKeyDown, beforeFocused)
  }, [beforeFocused])
}
