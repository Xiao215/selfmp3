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
  playbackStateSchema,
  secretKeySchema,
  secretValueSchema,
  transferIdSchema,
  type Command,
  type DesktopInfo,
} from '@selfmp3/desktop-bridge'

import * as files from './files.js'

import type { DeepLinks } from './deepLinks.js'
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
  ipcMain.handle(CHANNELS.setPlaybackState, (_event, state: unknown) => {
    playing = playbackStateSchema.parse(state).playing
  })

  deepLinks.listen(url => {
    window_()?.webContents.send(EVENTS.deepLink, url)
  })
}

let playing = false

/** What the shell believes is going on, for the phases that act on it. */
export function isPlaying(): boolean {
  return playing
}

/** Menu items and media keys, sent to whichever window is there to act. */
export function sendCommand(window_: BrowserWindow | null, command: Command): void {
  window_?.webContents.send(EVENTS.command, command)
}
