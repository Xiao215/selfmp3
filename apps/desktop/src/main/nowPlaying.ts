import { Menu, app, powerSaveBlocker } from 'electron'
import type { BrowserWindow } from 'electron'
import type { DockPlaybackState } from '@selfmp3/desktop-bridge'

import { sendCommand } from './commands.js'

/**
 * What the page says is playing, and the two things only the main process can
 * do about it: keep the machine awake, and draw the Dock menu.
 *
 * The now-playing card itself is not here. Chromium turns the page's
 * `navigator.mediaSession` into macOS's Now Playing and handles the media keys,
 * so the shell would only be a second, worse source of the same facts. What it
 * has that the page has not is `powerSaveBlocker` and the Dock.
 */

let state: DockPlaybackState = { playing: false, title: null, artist: null }
let blocker: number | null = null

/**
 * `prevent-app-suspension`, not `prevent-display-sleep`.
 *
 * The screen going dark while a record plays is correct, and a music player
 * that stops the display sleeping is a laptop that is flat by lunchtime. This
 * asks only that the app itself is not suspended — closing the lid still sleeps
 * the Mac, as it does with any player.
 */
function keepAwake(wanted: boolean): void {
  if (wanted && blocker === null) {
    blocker = powerSaveBlocker.start('prevent-app-suspension')
    return
  }
  if (!wanted && blocker !== null) {
    if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
    blocker = null
  }
}

/**
 * The Dock menu: the song, then the three controls worth having without
 * raising the window. Right-clicking the Dock icon is how a lot of people use
 * a music player they have cmd-tabbed away from.
 *
 * Rebuilt on every change rather than mutated, because an Electron `Menu` is
 * immutable once built and the whole thing is five items.
 */
function drawDock(window_: () => BrowserWindow | null): void {
  if (process.platform !== 'darwin') return
  const naming: Electron.MenuItemConstructorOptions[] = state.title
    ? [
        { label: state.title, enabled: false },
        ...(state.artist ? [{ label: state.artist, enabled: false }] : []),
        { type: 'separator' as const },
      ]
    : [{ label: 'Nothing playing', enabled: false }, { type: 'separator' as const }]

  app.dock?.setMenu(
    Menu.buildFromTemplate([
      ...naming,
      {
        label: state.playing ? 'Pause' : 'Play',
        click: () => sendCommand(window_(), 'play-pause'),
      },
      { label: 'Next', click: () => sendCommand(window_(), 'next') },
      { label: 'Previous', click: () => sendCommand(window_(), 'previous') },
    ]),
  )
}

/** Called by the `setPlaybackState` handler, and once at startup. */
export function setPlaybackState(
  next: DockPlaybackState,
  window_: () => BrowserWindow | null,
): void {
  const changed =
    next.playing !== state.playing || next.title !== state.title || next.artist !== state.artist
  state = next
  keepAwake(next.playing)
  if (changed) drawDock(window_)
}

/** The Dock menu exists before anything has played, saying so. */
export function startNowPlaying(window_: () => BrowserWindow | null): void {
  drawDock(window_)
}
