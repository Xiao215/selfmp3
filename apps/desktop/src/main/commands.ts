import { EVENTS, type Command } from '@selfmp3/desktop-bridge'
import type { BrowserWindow } from 'electron'

/**
 * Menu items, the Dock menu, and anything else the shell offers, sent to
 * whichever window is there to act on it.
 *
 * Its own module because both the menu and the Dock send commands, and the Dock
 * is drawn from the playback state the IPC handlers receive — putting this in
 * `ipc.ts` made those two import each other.
 */
export function sendCommand(window_: BrowserWindow | null, command: Command): void {
  window_?.webContents.send(EVENTS.command, command)
}
