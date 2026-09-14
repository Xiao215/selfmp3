import { join } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { APP_ORIGIN } from './protocol.js'

/**
 * The window.
 *
 * `contextIsolation` on, `nodeIntegration` off, `sandbox` on: the preload's
 * `contextBridge` object is the only thing the page can reach, which is the
 * plan's rule that the bridge is the only door. `webSecurity` is left alone —
 * turning it off is how an Electron app stops being a browser.
 *
 * Saved bounds, the inset title bar and hiding on the red button are phase 4;
 * this opens at the size the reference captures were taken at.
 */
export function createWindow({
  preload,
  devUrl,
}: {
  readonly preload: string
  readonly devUrl: string | null
}): BrowserWindow {
  const window_ = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 480,
    // The app's own background, so a cold launch does not flash white before
    // the first paint.
    backgroundColor: '#14121a',
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window_.once('ready-to-show', () => window_.show())

  /*
   * A link to anywhere else opens in the person's own browser rather than
   * turning this window into one. Without this, a docs link would navigate the
   * app away from itself with no way back.
   */
  window_.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window_.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN) && !(devUrl !== null && url.startsWith(devUrl))) {
      event.preventDefault()
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    }
  })

  void window_.loadURL(devUrl ?? `${APP_ORIGIN}/`)
  return window_
}

/** Where the preload ends up next to the built main process. */
export function preloadPath(): string {
  return join(__dirname, 'preload.cjs')
}
