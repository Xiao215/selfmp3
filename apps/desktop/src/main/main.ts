import { join } from 'node:path'

import { app, autoUpdater, net } from 'electron'
import type { BrowserWindow } from 'electron'
import { EVENTS } from '@selfmp3/desktop-bridge'
import { DEEP_LINK_SCHEME } from '@selfmp3/shared'

import { DeepLinks, deepLinkFromArgv, followPage } from './deepLinks.js'
import { directoryFor } from './files.js'
import { desktopInfo, registerIpc } from './ipc.js'
import { buildMenu } from './menu.js'
import { startNowPlaying } from './nowPlaying.js'
import { handleAppScheme, registerAppScheme } from './protocol.js'
import { createStreamProxy } from './stream.js'
import { createWindow, preloadPath } from './window.js'

/**
 * The shell's lifecycle.
 *
 * One instance, one window, `selfmp3://` claimed, and the page served from
 * `app://selfmp3/` — or from Metro when `npm run dev:desktop` set
 * `SELFMP3_DESKTOP_DEV_URL`, which is the only difference between a development
 * window and the real one. The renderer is the same build either way: the plan's
 * first ground rule is that there is never a second export.
 */

/** Where the export sits, beside the built main process inside the bundle. */
const WEB_ROOT = join(__dirname, 'web')

const devUrl = process.env['SELFMP3_DESKTOP_DEV_URL'] ?? null
const deepLinks = new DeepLinks()

let mainWindow: BrowserWindow | null = null
const currentWindow = (): BrowserWindow | null => mainWindow

/*
 * Set by `before-quit`, and read by the window's `close` handler: on macOS the
 * red button hides the window, and the only thing that may really close it is
 * the app going away. Without the flag, ⌘Q would hide the window and leave the
 * app running with no way to get it back except the Dock.
 *
 * Installing an update is the other way out, and it does not pass through
 * `before-quit` in time: `quitAndInstall` closes the windows first and only
 * then emits it, so the close handler saw an app that was not quitting, hid the
 * window, and the update never went in. `before-quit-for-update` comes before
 * the windows close: on a Mac, the one place a build installs its own updates,
 * electron-updater hands the install to Electron's updater, which emits it.
 */
let quitting = false
const isQuitting = (): boolean => quitting

/**
 * The one window, the handler that forgets it, and the deep links that follow
 * its page.
 *
 * All three happen together: `mainWindow` still pointing at a destroyed
 * window is how `showWindow` ends up calling `show()` on nothing, and a window
 * made again has to take the links over from the one that went.
 */
function openWindow(): void {
  mainWindow = createWindow({ preload: preloadPath(), devUrl, quitting: isQuitting })
  followPage(deepLinks, mainWindow.webContents, EVENTS.deepLink)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/** One window, reused: hidden rather than closed, so this shows it again. */
function showWindow(): void {
  if (mainWindow === null) {
    openWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

registerAppScheme()

/*
 * A second launch must not open a second app: it hands over whatever it was
 * carrying — a `selfmp3://` sign-in return, most of the time — and exits.
 */
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  app.on('second-instance', (_event, argv) => {
    deepLinks.deliver(deepLinkFromArgv(argv))
    showWindow()
  })

  // macOS delivers a URL to a running app this way, and to a cold one just
  // after `ready`; everywhere else it is argv, above and below. A link is
  // something to look at, so a window closed with the red button comes back
  // for it; before `ready` the window is about to open anyway.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deepLinks.deliver(url)
    if (app.isReady()) showWindow()
  })

  app
    .whenReady()
    .then(() => {
      /*
       * In development Electron is not the bundle, so the scheme has to be
       * claimed with the binary and the entry script named; a packaged app
       * needs neither argument.
       */
      if (process.defaultApp) {
        const entry = process.argv[1]
        if (entry !== undefined)
          app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [entry])
      } else {
        app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
      }

      // Chromium's network stack, as downloads use: the system's proxy and certificates.
      const stream = createStreamProxy({
        fetch: (url, init) => net.fetch(url, init),
        onCapped: message => mainWindow?.webContents.send(EVENTS.bucketCapped, message),
        dir: directoryFor('played'),
      })
      handleAppScheme({
        web: WEB_ROOT,
        devOrigin: devUrl === null ? null : new URL(devUrl).origin,
        stream,
      })

      const info = desktopInfo({ development: devUrl !== null })
      openWindow()

      registerIpc({ info, window: currentWindow, stream })
      buildMenu(currentWindow, showWindow)
      startNowPlaying(currentWindow)

      deepLinks.deliver(deepLinkFromArgv(process.argv))
    })
    .catch((error: unknown) => {
      console.error('self.mp3 failed to start', error)
      app.exit(1)
    })

  // The Dock icon, with the window hidden or gone.
  app.on('activate', () => showWindow())

  app.on('before-quit', () => {
    quitting = true
  })
  autoUpdater.on('before-quit-for-update', () => {
    quitting = true
  })

  /*
   * A Mac app outlives its windows; everywhere else closing the last window is
   * quitting. On macOS the red button only hides the window (`window.ts`), so
   * this is reached there solely on the way out.
   */
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
