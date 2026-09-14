import { useEffect, useRef } from 'react'
import { pageKeptCombinations } from '@selfmp3/desktop-bridge'

import type { Command, CommandHandlers } from './useCommands'
import { useHotkeys } from './useHotkeys'
import { desktop } from '../ports/desktop/bridge'

export type { Command, CommandHandlers }

/**
 * The keys the menu draws but does not take, and what each one means.
 *
 * Space and the ⌘-arrows are in the menu for discoverability — that is how a
 * person learns their app has them — but registering them as accelerators would
 * take them out of every text field in the app. So the menu shows them, the
 * page handles them, and this is the table both sides read. Empty in a browser,
 * where there is no menu and the web app has never had playback shortcuts.
 */
const kept: ReadonlyMap<string, Command> = desktop
  ? pageKeptCombinations()
  : new Map<string, Command>()

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

  /*
   * Only the combinations this caller actually answers. Two components use this
   * hook — the palette and the frame — and a hotkey registered for a command
   * with no handler would swallow the key and do nothing.
   *
   * Rebuilt each render rather than memoised: it is at most five entries, and
   * `useHotkeys` holds whatever it is given in a ref and subscribes once, so a
   * fresh object costs nothing.
   */
  const bound: Record<string, () => void> = {}
  for (const [combination, command] of kept) {
    if (handlers[command]) bound[combination] = () => latest.current[command]?.()
  }
  useHotkeys(bound)
}
