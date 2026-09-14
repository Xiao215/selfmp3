import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'

import { contentTypeFor, resolveWithinRoot } from './paths.js'

/**
 * `app://selfmp3/` — where the page lives.
 *
 * Not `file://`, which registers no service workers and gives IndexedDB no
 * stable origin, and not a loopback HTTP server, which would need a fixed port
 * or lose every kept preference on each launch when the port changed. A
 * privileged custom scheme is a real origin that never moves.
 *
 * `allowServiceWorkers` is deliberately off. The browser's worker exists to
 * serve songs out of the Cache API; here songs are files and the shell is
 * served from disk, and a second copy of the audio would be a second truth.
 */

export const APP_ORIGIN = 'app://selfmp3'

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        allowServiceWorkers: false,
      },
    },
  ])
}

export interface ProtocolRoots {
  /** `apps/app/dist`, copied into the bundle's resources by electron-builder. */
  readonly web: string
}

export function handleAppScheme(roots: ProtocolRoots): void {
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    const resolved = resolveWithinRoot(roots.web, url.pathname)

    // Everything the export does not have a file for is a route, and a route
    // is index.html: the same rule the Mac's server and GitHub Pages follow.
    const file = resolved !== null && (await isFile(resolved)) ? resolved : join(roots.web, 'index.html')

    try {
      const stats = await stat(file)
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(file),
          'Content-Length': String(stats.size),
          // The export's filenames carry a content hash, so a long cache is
          // safe; index.html is the one that must not be held, and it is
          // re-read on every launch anyway.
          'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
