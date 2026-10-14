import { useEffect, useRef } from 'react'

import { registerKey } from './keyRegistry'

/** A key combination's handler: `meta+k`, `ctrl+k`. */
export type Hotkeys = Readonly<Record<string, () => void>>

export interface HotkeyOptions {
  /**
   * Answer before whatever has focus, and keep the key from it.
   *
   * For keys that mean the same thing wherever focus is, like Space for play
   * and pause: a focused button would otherwise take Space as a press of
   * itself. Text fields, menus and dialogs still keep their keys. A held key
   * answers once: its repeats are kept from focus and otherwise ignored, or
   * holding Space would flip between play and pause.
   *
   * The web's alone: on an iPad a key command is answered before anything has
   * focus, so every key here is.
   */
  readonly beforeFocused?: boolean
}

/**
 * Keys a screen answers while it is open, for a device with a keyboard.
 *
 * On an iPad or an iPhone with a hardware keyboard, each one is a key command
 * (`keyRegistry`, `ports/keyCommands`), and none is answered while a text
 * field is being typed in, as on the web. Where there is no keyboard nothing
 * is pressed, and on Android, which has no module, nothing is registered. The
 * browser build listens on the window (`useHotkeys.web.ts`).
 *
 * Not for app-wide shortcuts: those come through `useCommands` — the menu's
 * keys, on a computer and on an iPad alike, and a browser tab's single one,
 * Space for play and pause (`playbackKeys`). What is left is in context: keys
 * that mean something only on the page that listens for them.
 */
export function useHotkeys(hotkeys: Hotkeys, _options?: HotkeyOptions): void {
  const latest = useRef(hotkeys)
  useEffect(() => {
    latest.current = hotkeys
  })

  // Registered again only when the set of keys changes, not when a handler does.
  const combinations = Object.keys(hotkeys).sort().join('\n')
  useEffect(() => {
    if (!combinations) return undefined
    const removals = combinations.split('\n').map(combination =>
      registerKey({
        combination,
        whileTyping: false,
        run: () => latest.current[combination]?.(),
      }),
    )
    return () => removals.forEach(remove => remove())
  }, [combinations])
}
