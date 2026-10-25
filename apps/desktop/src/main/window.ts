import { join } from 'node:path'

import { BrowserWindow, screen, shell } from 'electron'
import { APP_ORIGIN } from '@selfmp3/desktop-bridge'

import { MINIMUM_SIZE, openingBounds, rememberBounds } from './bounds.js'
import { openingGround } from './ground.js'

/**
 * The window.
 *
 * `contextIsolation` on, `nodeIntegration` off, `sandbox` on: the preload's
 * `contextBridge` object is the only thing the page can reach, which is the
 * plan's rule that the bridge is the only door. `webSecurity` is left alone —
 * turning it off is how an Electron app stops being a browser.
 *
 * It opens where it was left, if that is still somewhere a person can reach,
 * and at the size the reference captures were taken at otherwise.
 *
 * `titleBarStyle: 'hiddenInset'` is the one deliberate visual difference from
 * the browser the plan allows: the traffic lights sit over the sidebar's top
 * rather than in a bar above the app. The page pads the sidebar for them, told
 * how much by `info.titleBarInset`, because only the shell knows whether there
 * is an inset title bar at all.
 */
export function createWindow({
  preload,
  devUrl,
  quitting,
}: {
  readonly preload: string
  readonly devUrl: string | null
  /** True once ⌘Q or Quit has been chosen, so the window really does close. */
  readonly quitting: () => boolean
}): BrowserWindow {
  const mac = process.platform === 'darwin'
  const window_ = new BrowserWindow({
    ...openingBounds(screen.getAllDisplays()),
    minWidth: MINIMUM_SIZE.width,
    minHeight: MINIMUM_SIZE.height,
    // The traffic lights over the sidebar, and no bar above the app. Only on
    // macOS: Windows and Linux draw their own frame and have no inset to pad.
    ...(mac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    // The app's own background, so a cold launch does not flash white before
    // the first paint — and the theme's own value, the one the page last
    // showed (`ground.ts`), so it does not flash a near miss or the other theme.
    backgroundColor: openingGround(),
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window_.once('ready-to-show', () => window_.show())
  rememberBounds(window_)

  /*
   * The red button hides the window; it does not quit. A player that is playing
   * and has no window is a normal thing to want, and on macOS the app is alive
   * until ⌘Q either way — without this, closing the window stopped the music.
   * The Dock icon and ⌘N bring it back (`app.on('activate')`).
   */
  if (mac) {
    window_.on('close', event => {
      if (quitting()) return
      event.preventDefault()
      window_.hide()
    })
  }

  /*
   * A link to anywhere else opens in the person's own browser rather than
   * turning this window into one. Without this, a docs link would navigate the
   * app away from itself with no way back.
   */
  window_.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  // Whole origins, so `app://selfmp3.example` or another port does not pass for the app.
  const ownOrigins = devUrl === null ? [APP_ORIGIN] : [APP_ORIGIN, new URL(devUrl).origin]
  const isOwnPage = (url: string): boolean =>
    ownOrigins.some(origin => url === origin || url.startsWith(`${origin}/`))
  window_.webContents.on('will-navigate', (event, url) => {
    if (!isOwnPage(url)) {
      event.preventDefault()
      openOutside(url)
    }
  })

  void window_.loadURL(devUrl ?? `${APP_ORIGIN}/`)
  return window_
}

/**
 * A link to somewhere on the web, opened in the person's own browser. Only a
 * web address: anything else (`file:`, `javascript:`, another app's scheme)
 * would be the page asking the system to open a file or another app.
 */
export function openOutside(url: string): void {
  if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
}

/** Where the preload ends up next to the built main process. */
export function preloadPath(): string {
  return join(__dirname, 'preload.cjs')
}
