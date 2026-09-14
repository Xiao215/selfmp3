/** A key combination's handler: `meta+k`, `ctrl+k`, as the web app names them. */
export type Hotkeys = Readonly<Record<string, () => void>>

/**
 * Keys a screen answers while it is open, for a device with a keyboard.
 *
 * A phone has none worth listening to — its keyboard is for typing into a
 * field — so here this does nothing. The browser build listens on the window
 * (`useHotkeys.web.ts`).
 *
 * Not for app-wide shortcuts: a browser tab has none (decided 2026-09-14), and
 * the installed app's come from its menu through `useCommands`. What is left is
 * in context, such as the Untagged page's triage keys.
 */
export function useHotkeys(_hotkeys: Hotkeys): void {}
