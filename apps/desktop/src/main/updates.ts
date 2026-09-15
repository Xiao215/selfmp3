import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import { EVENTS, type UpdateStatus } from '@selfmp3/desktop-bridge'

import { isNewer, versionFromTag } from './updates.rule.js'

/**
 * Whether there is a newer self.mp3, and what can be done about it.
 *
 * Two tiers, because a build has two.
 *
 * A **signed** build hands the whole thing to electron-updater: it reads the
 * repository's releases, downloads in the background, and swaps the app on
 * quit. A **ad-hoc** build cannot — Squirrel refuses to apply an update whose
 * signature it cannot verify (electron #36640), and it is right to: an
 * auto-updater that accepts anything is a way to replace someone's music player
 * with something else. So an unsigned build compares versions and offers the
 * release page, and says as much.
 *
 * `canInstall` is what the page draws the difference from, so Settings never
 * offers a button that would fail.
 */

/** The releases this app is a build of. */
const OWNER = 'Xiao215'
const REPO = 'selfmp3'
const LATEST = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases`

let status: UpdateStatus = {
  state: 'idle',
  version: null,
  releaseUrl: null,
  canInstall: false,
  message: null,
}

/** Where electron-updater's events go: the window that asked last. */
let updateWindow: BrowserWindow | null = null
let listening = false

/**
 * Set by `scripts/build.mjs` from the tier `scripts/dist.mjs` chose. Nothing
 * asks the running app about its own signature — there is no API for it, and
 * the question is settled when the app is packaged, not when it runs.
 */
declare const __SELFMP3_SIGNED__: boolean

/**
 * A signed, packaged build is the only one that can update itself. `isPackaged`
 * rules out `npm run dev:desktop`, where the "app" is Electron's own binary and
 * there is nothing to replace.
 */
function canInstall(): boolean {
  return app.isPackaged && __SELFMP3_SIGNED__
}

function publish(window_: BrowserWindow | null, next: Partial<UpdateStatus>): void {
  status = { ...status, ...next }
  window_?.webContents.send(EVENTS.update, status)
}

export function currentStatus(): UpdateStatus {
  return status
}

/**
 * Ask. Safe to call from a menu item and from Settings; the answer is published
 * on the `update` event as well as returned, so both see the same thing.
 */
export async function check(window_: BrowserWindow | null): Promise<UpdateStatus> {
  publish(window_, { state: 'checking', message: null, canInstall: canInstall() })

  if (canInstall()) {
    try {
      // Imported here rather than at the top: electron-updater reads app paths
      // when it loads, and an ad-hoc build never needs it at all.
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = true
      updateWindow = window_
      // Once, however often this is asked: listeners added on every check
      // piled up, and each event then published once per check so far.
      if (!listening) {
        listening = true
        autoUpdater.on('update-available', info =>
          publish(updateWindow, { state: 'downloading', version: info.version }),
        )
        autoUpdater.on('update-not-available', () => publish(updateWindow, { state: 'none' }))
        autoUpdater.on('update-downloaded', info =>
          publish(updateWindow, { state: 'ready', version: info.version }),
        )
        autoUpdater.on('error', error =>
          publish(updateWindow, { state: 'error', message: error.message }),
        )
      }
      await autoUpdater.checkForUpdates()
      return status
    } catch (error) {
      publish(window_, { state: 'error', message: messageOf(error) })
      return status
    }
  }

  try {
    const response = await fetch(LATEST, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
    const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const tag = typeof body.tag_name === 'string' ? body.tag_name : ''
    const found = versionFromTag(tag)
    const url = typeof body.html_url === 'string' ? body.html_url : RELEASES
    if (found === null) {
      publish(window_, { state: 'none', message: 'no release to compare with' })
      return status
    }
    publish(
      window_,
      isNewer(found, app.getVersion())
        ? { state: 'available', version: found, releaseUrl: url }
        : { state: 'none', version: found, releaseUrl: url },
    )
    return status
  } catch (error) {
    publish(window_, { state: 'error', message: messageOf(error) })
    return status
  }
}

/** Quit and swap. Only ever reachable when `canInstall` said so. */
export async function install(): Promise<void> {
  if (!canInstall() || status.state !== 'ready') return
  const { autoUpdater } = await import('electron-updater')
  autoUpdater.quitAndInstall()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
