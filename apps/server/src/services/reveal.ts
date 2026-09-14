import { execFile } from 'node:child_process'
import path from 'node:path'
import type { Request } from 'express'

/**
 * "Show in Finder": open the file manager on the machine running the server,
 * with the song's file selected.
 *
 * This only makes sense for the browser on that same machine. A phone asking
 * would open a Finder window on the server across the room, so requests are
 * checked: they must arrive over loopback *and* ask for a loopback host.
 * The second check matters because `tailscale serve` also connects from
 * loopback — but a request through it asks for the tailnet name, not
 * `localhost`.
 */

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function isLocalRequest(req: Pick<Request, 'socket' | 'headers'>): boolean {
  const remote = req.socket.remoteAddress ?? ''
  const host = (req.headers.host ?? '')
    .replace(/:\d+$/, '')
    .replace(/^\[(.*)\]$/, '$1')
    .toLowerCase()
  return LOOPBACK_ADDRESSES.has(remote) && LOOPBACK_HOSTS.has(host)
}

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
