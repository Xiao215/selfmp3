import { api } from './api.js'
import { showToast } from '../components/Toast.js'

/**
 * "Show in Finder", for the browser on the computer that runs self.mp3.
 *
 * Only offered there (see `isServerMachine`): it is the one place the server
 * can open a window you will actually see, and the server refuses anyone
 * else anyway.
 */

/** What this computer calls its file manager, for the "Show in …" label. */
export function fileManagerName(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  if (/Mac/i.test(userAgent)) return 'Finder'
  if (/Windows/i.test(userAgent)) return 'File Explorer'
  return 'Files'
}

/** Ask the server to select the song's file; say why if it can't. */
export function showInFileManager(songId: number): void {
  api.revealSong(songId).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : 'something went wrong'
    showToast(`Couldn’t show it in ${fileManagerName()}: ${reason}.`, 'error', 5000)
  })
}
