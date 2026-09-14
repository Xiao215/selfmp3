import { useEffect, useRef } from 'react'

import type { Command, CommandHandlers } from './useCommands'
import { desktop } from '../ports/desktop/bridge'

export type { Command, CommandHandlers }

/**
 * Menu items and media keys, from the desktop shell.
 *
 * Nothing happens in an ordinary browser tab: there is no bridge, so there is
 * nothing to subscribe to. In the installed app every menu item and every media
 * key arrives here as a `Command` from `packages/desktop-bridge` — the same
 * vocabulary the menu is built from, so an item the page does not handle is a
 * failing test in that package rather than a key that does nothing.
 *
 * The handlers are held in a ref and the subscription is made once. A menu
 * click is not a render, and re-subscribing on every render would churn a
 * listener through the bridge several times a second while a song plays.
 */
export function useCommands(handlers: CommandHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    if (!desktop) return
    return desktop.onCommand((command: Command) => {
      latest.current[command]?.()
    })
  }, [])
}
