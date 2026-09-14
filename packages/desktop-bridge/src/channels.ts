/**
 * Every name that crosses the preload boundary, one constant each.
 *
 * Both sides import these rather than writing the string twice: the shell
 * registers `ipcMain.handle(CHANNELS.filesDownload, …)` and the preload calls
 * `ipcRenderer.invoke(CHANNELS.filesDownload, …)`, so a rename is a compile
 * error rather than a channel that quietly answers nothing.
 *
 * `invoke` channels are the page asking and the shell answering. `emit`
 * channels are the shell telling the page something it did not ask for, and
 * only ever travel that way.
 */

export const CHANNELS = {
  info: 'selfmp3:info',

  secretsGet: 'selfmp3:secrets.get',
  secretsSet: 'selfmp3:secrets.set',
  secretsRemove: 'selfmp3:secrets.remove',

  openExternal: 'selfmp3:openExternal',
  setPlaybackState: 'selfmp3:setPlaybackState',

  loginItemGet: 'selfmp3:loginItem.get',
  loginItemSet: 'selfmp3:loginItem.set',

  updatesCheck: 'selfmp3:updates.check',
  updatesInstall: 'selfmp3:updates.install',
} as const

/** One way only: the shell speaks, the page listens. */
export const EVENTS = {
  deepLink: 'selfmp3:event.deepLink',
  command: 'selfmp3:event.command',
  progress: 'selfmp3:event.progress',
  update: 'selfmp3:event.update',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

/** The name the preload puts on the window, and nothing else goes on it. */
export const BRIDGE_GLOBAL = 'selfmp3Desktop'
