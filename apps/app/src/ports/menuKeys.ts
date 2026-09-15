import type { MenuCommand } from '@selfmp3/desktop-bridge'

export type { MenuCommand }

/**
 * The application menu's items and their keys, where there is an application
 * menu: the installed desktop app's View, Playback and Settings… items.
 *
 * `null` everywhere else, and on a phone above all. A phone has no menu bar,
 * and a browser tab has no menu keys (decided 2026-09-14): the keys a tab would
 * take are the browser's, all but Space for play and pause. So a screen that shows keys —
 * Settings › Keyboard shortcuts, the sidebar's ⌘K beside Search — asks this,
 * and shows nothing when the answer is no menu.
 *
 * Read through a port because the list is the desktop bridge's, and features
 * do not import the bridge.
 */
export const menuCommands: readonly MenuCommand[] | null = null
