import { execFile } from 'node:child_process'
import path from 'node:path'

/**
 * "Show in Finder": open the file manager on the machine running the server,
 * with the song's file selected.
 *
 * This only makes sense for the browser on that same machine — a phone asking
 * would open a Finder window on the server across the room — so the route
 * checks `isLocalRequest` (`http/local.ts`) first. That is the same question
 * the bearer check asks about who is exempt from the token, so it is answered
 * in one place, with the reasoning kept beside it.
 */

/** The command that selects a file in this platform's file manager, if there is one. */
export function revealCommand(
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: ['-R', absolutePath] }
    case 'win32':
      return { command: 'explorer.exe', args: [`/select,${absolutePath}`] }
    case 'linux':
      // No common way to select a file across Linux file managers; the folder
      // is the honest best.
      return { command: 'xdg-open', args: [path.dirname(absolutePath)] }
    default:
      return null
  }
}

/** Run it. No shell, so a song's filename can never be read as a command. */
export function revealInFileManager(absolutePath: string): Promise<void> {
  const reveal = revealCommand(absolutePath)
  if (!reveal) return Promise.reject(new Error(`no file manager on ${process.platform}`))

  return new Promise((resolve, reject) => {
    execFile(reveal.command, reveal.args, { windowsHide: true }, error => {
      // Explorer exits 1 even when it opened fine.
      if (error && process.platform !== 'win32') {
        reject(new Error(`could not open ${reveal.command}: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}
