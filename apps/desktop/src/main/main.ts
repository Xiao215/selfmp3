import { join } from 'node:path'

import { app } from 'electron'
import type { BrowserWindow } from 'electron'

import { DeepLinks, deepLinkFromArgv } from './deepLinks.js'
import { desktopInfo, registerIpc } from './ipc.js'
import { buildMenu } from './menu.js'
import { startNowPlaying } from './nowPlaying.js'
import { handleAppScheme, registerAppScheme } from './protocol.js'
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
 */
let quitting = false
const isQuitting = (): boolean => quitting

/** One window, reused: hidden rather than closed, so this shows it again. */
function showWindow(): void {
  if (mainWindow === null) {
    mainWindow = createWindow({ preload: preloadPath(), devUrl, quitting: isQuitting })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
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
  // after `ready`; everywhere else it is argv, above and below.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deepLinks.deliver(url)
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
        if (entry !== undefined) app.setAsDefaultProtocolClient('selfmp3', process.execPath, [entry])
      } else {
        app.setAsDefaultProtocolClient('selfmp3')
      }

      handleAppScheme({ web: WEB_ROOT })

      const info = desktopInfo({ development: devUrl !== null })
      mainWindow = createWindow({ preload: preloadPath(), devUrl, quitting: isQuitting })
      mainWindow.on('closed', () => {
        mainWindow = null
      })

      registerIpc({ info, deepLinks, window: currentWindow })
      buildMenu(currentWindow)
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

  /*
   * A Mac app outlives its windows; everywhere else closing the last window is
   * quitting. On macOS the red button only hides the window (`window.ts`), so
   * this is reached there solely on the way out.
   */
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
