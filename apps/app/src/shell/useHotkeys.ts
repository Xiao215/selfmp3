/** A key combination's handler: `meta+k`, `ctrl+k`, as the web app names them. */
export type Hotkeys = Readonly<Record<string, () => void>>

/**
 * Keyboard shortcuts, for a device with a keyboard.
 *
 * A phone has none worth listening to — its keyboard is for typing into a
 * field — so here this does nothing. The browser build listens on the window
 * (`useHotkeys.web.ts`).
 */
export function useHotkeys(_hotkeys: Hotkeys): void {}
