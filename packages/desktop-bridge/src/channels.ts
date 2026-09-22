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

  filesDownload: 'selfmp3:files.download',
  filesCancel: 'selfmp3:files.cancel',
  filesDelete: 'selfmp3:files.delete',
  filesStat: 'selfmp3:files.stat',
  filesList: 'selfmp3:files.list',
  filesFetchTo: 'selfmp3:files.fetchTo',
  filesWrite: 'selfmp3:files.write',
  filesUsage: 'selfmp3:files.usage',
  filesReveal: 'selfmp3:files.reveal',
  filesClear: 'selfmp3:files.clear',

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

/** The name the preload puts on the window, and nothing else goes on it. */
export const BRIDGE_GLOBAL = 'selfmp3Desktop'

/**
 * Where the page lives in an installed app.
 *
 * Here rather than in the shell because both halves spell it: the main process
 * serves this origin (`main/protocol.ts` says why a privileged scheme and not
 * `file:`), the preload builds `mediaUrl` against it, and the window's
 * navigation guard uses it to decide what still counts as the app.
 */
export const APP_ORIGIN = 'app://selfmp3'

/** Under `APP_ORIGIN`: songs and covers on disk, served with a real 206. */
export const MEDIA_PREFIX = '/_media/'

/**
 * The scheme the operating system hands back — `selfmp3://welcome#signin-code=…`.
 *
 * The shell claims it, `deepLinks.ts` picks it out of argv, and the schema the
 * page parses arrivals with is built from it, so all three move together.
 */
export const DEEP_LINK_SCHEME = 'selfmp3'
