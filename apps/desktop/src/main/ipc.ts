import { hostname } from 'node:os'
import { join } from 'node:path'

import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import {
  CHANNELS,
  EVENTS,
  downloadRequestSchema,
  externalUrlSchema,
  fileKindSchema,
  fileNameSchema,
  loginItemSchema,
  playbackStateSchema,
  secretKeySchema,
  secretValueSchema,
  transferIdSchema,
  type DesktopInfo,
} from '@selfmp3/desktop-bridge'

import * as files from './files.js'

import type { DeepLinks } from './deepLinks.js'
import { setPlaybackState } from './nowPlaying.js'
import { encryptionAvailable, secretStore } from './secrets.js'

/**
 * One handler per channel, each parsing what it was given.
 *
 * The renderer is a web page. If it is ever the thing that goes wrong, the main
 * process is the half with a filesystem and a keychain, and these schemas are
 * what stands between them — so every argument is parsed here even though the
 * preload has already typed it, because a type is a promise and a schema is a
 * check.
 */

export function desktopInfo({ development }: { development: boolean }): DesktopInfo {
  const userData = app.getPath('userData')
  return {
    platform: process.platform as DesktopInfo['platform'],
    version: app.getVersion(),
    // "Xiao's MacBook Pro" — what a browser has to guess from a user agent.
    hostname: hostname().replace(/\.local$/, ''),
    userData,
    songsDir: join(userData, 'songs'),
    development,
    secretsSealed: encryptionAvailable(),
    // The traffic lights, and a little air under them. Only macOS hides the
    // title bar into the page; every other platform draws its own frame.
    titleBarInset: process.platform === 'darwin' ? 28 : 0,
  }
}

export function registerIpc({
  info,
  deepLinks,
  window: window_,
}: {
  readonly info: DesktopInfo
  readonly deepLinks: DeepLinks
  readonly window: () => BrowserWindow | null
}): void {
  // Answered synchronously: the preload reads it at load, before the page runs.
  ipcMain.on(CHANNELS.info, event => {
    event.returnValue = info
  })

  ipcMain.handle(CHANNELS.secretsGet, (_event, key: unknown) =>
    secretStore.get(secretKeySchema.parse(key)),
  )
  ipcMain.handle(CHANNELS.secretsSet, (_event, key: unknown, value: unknown) => {
    secretStore.set(secretKeySchema.parse(key), secretValueSchema.parse(value))
  })
  ipcMain.handle(CHANNELS.secretsRemove, (_event, key: unknown) => {
    secretStore.remove(secretKeySchema.parse(key))
  })

  ipcMain.handle(CHANNELS.filesDownload, async (event, request: unknown) => {
    const parsed = downloadRequestSchema.parse(request)
    return files.download(parsed, (bytesWritten, totalBytes) => {
      // Straight back to whoever asked, rather than to whatever window happens
      // to be first: a progress event belongs to the page that started it.
      event.sender.send(EVENTS.progress, { id: parsed.id, bytesWritten, totalBytes })
    })
  })
  ipcMain.handle(CHANNELS.filesCancel, (_event, id: unknown) => {
    files.cancel(transferIdSchema.parse(id))
  })
  ipcMain.handle(CHANNELS.filesDelete, (_event, kind: unknown, name: unknown) =>
    files.remove(fileKindSchema.parse(kind), fileNameSchema.parse(name)),
  )
  ipcMain.handle(CHANNELS.filesStat, (_event, kind: unknown, name: unknown) =>
    files.statOne(fileKindSchema.parse(kind), fileNameSchema.parse(name)),
  )
  ipcMain.handle(CHANNELS.filesList, (_event, kind: unknown) =>
    files.list(fileKindSchema.parse(kind)),
  )
  ipcMain.handle(
    CHANNELS.filesFetchTo,
    (_event, kind: unknown, name: unknown, url: unknown, headers: unknown) =>
      files.fetchTo(
        fileKindSchema.parse(kind),
        fileNameSchema.parse(name),
        externalUrlSchema.parse(url),
        headers === undefined ? undefined : (headers as Record<string, string>),
      ),
  )
  ipcMain.handle(CHANNELS.filesUsage, () => files.usage())
  ipcMain.handle(CHANNELS.filesReveal, (_event, kind: unknown, name: unknown) =>
    files.reveal(
      fileKindSchema.parse(kind),
      name === undefined || name === null ? undefined : fileNameSchema.parse(name),
    ),
  )
  ipcMain.handle(CHANNELS.filesClear, (_event, kind: unknown) =>
    files.clear(fileKindSchema.parse(kind)),
  )

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: unknown) => {
    await shell.openExternal(externalUrlSchema.parse(url))
  })

  /*
   * Accepted and, in this phase, only remembered. Phase 4 is where it holds a
   * power-save blocker and labels the Dock menu; taking the channel now means
   * the page can publish its state from the moment the provider is wired,
   * rather than gaining a new call later.
   */
  /*
   * Open at login. Reading it back from the OS rather than remembering what was
   * asked for: System Settings can turn it off behind the app's back, and a
   * toggle that then still shows "on" is a toggle nobody trusts again.
   */
  ipcMain.handle(CHANNELS.loginItemGet, () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle(CHANNELS.loginItemSet, (_event, value: unknown) => {
    const { open } = loginItemSchema.parse({ open: value })
    // Just `openAtLogin`. `openAsHidden` — which would have opened it without
    // a window — was removed when macOS moved login items to ServiceManagement,
    // and Electron dropped it with the rest of that API.
    app.setLoginItemSettings({ openAtLogin: open })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle(CHANNELS.setPlaybackState, (_event, state: unknown) => {
    setPlaybackState(playbackStateSchema.parse(state), window_)
  })

  deepLinks.listen(url => {
    window_()?.webContents.send(EVENTS.deepLink, url)
  })
}
