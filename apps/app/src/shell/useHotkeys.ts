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
   */
  readonly beforeFocused?: boolean
}

/**
 * Keys a screen answers while it is open, for a device with a keyboard.
 *
 * A phone has none worth listening to — its keyboard is for typing into a
 * field — so here this does nothing. The browser build listens on the window
 * (`useHotkeys.web.ts`).
 *
 * Not for app-wide shortcuts: those come through `useCommands` — the installed
 * app's from its menu, and a browser tab's single one, Space for play and pause
 * (`playbackKeys`). What is left is in context: keys that mean something
 * only on the page that listens for them.
 */
export function useHotkeys(_hotkeys: Hotkeys, _options?: HotkeyOptions): void {}
