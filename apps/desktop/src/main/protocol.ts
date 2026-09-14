import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'
import { answerRange } from '@selfmp3/shared'
import { fileKindSchema, type FileKind } from '@selfmp3/desktop-bridge'

import { directoryFor } from './files.js'
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

/** Where downloaded songs and covers are served from. */
export const MEDIA_PREFIX = '/_media/'

export function mediaPath(kind: FileKind, name: string): string {
  return `${APP_ORIGIN}${MEDIA_PREFIX}${kind}/${encodeURIComponent(name)}`
}

export function handleAppScheme(roots: ProtocolRoots): void {
  protocol.handle('app', async request => {
    const url = new URL(request.url)

    if (url.pathname.startsWith(MEDIA_PREFIX)) return serveMedia(request, url.pathname)

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

/**
 * A downloaded song or cover, with `Range:` answered properly.
 *
 * Two things have to be right here or the player misbehaves in ways that look
 * like the engine's fault.
 *
 * The **206**: `net.fetch('file://…')` ignores a `Range:` header and answers
 * 200 with the whole body, so the answer is built by hand from
 * `packages/shared`'s rule — the same one the server has been seeking with for
 * a year.
 *
 * The **CORS pair**: the engine sets `crossOrigin = 'use-credentials'` so the
 * analyser may read the samples, and that mode rejects `*`. The page's own
 * origin is echoed back instead, which is `app://selfmp3` in the app and
 * `http://localhost:4601` in `npm run dev:desktop`.
 */
async function serveMedia(request: Request, pathname: string): Promise<Response> {
  const rest = pathname.slice(MEDIA_PREFIX.length)
  const slash = rest.indexOf('/')
  const kind = fileKindSchema.safeParse(slash === -1 ? '' : rest.slice(0, slash))
  if (!kind.success) return new Response('not found', { status: 404 })

  const file = resolveWithinRoot(directoryFor(kind.data), `/${rest.slice(slash + 1)}`)
  if (file === null || !(await isFile(file))) return new Response('not found', { status: 404 })

  const stats = await stat(file)
  const answer = answerRange({
    rangeHeader: request.headers.get('Range') ?? undefined,
    sizeBytes: stats.size,
    mime: contentTypeFor(file),
    // The file never changes once written — the name carries the song's rev —
    // so size and mtime are an honest strong validator.
    etag: `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
    lastModified: stats.mtime,
  })

  const origin = request.headers.get('Origin') ?? APP_ORIGIN
  const headers = new Headers(answer.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')

  if (answer.status === 416 || answer.length === 0) {
    return new Response(null, { status: answer.status, headers })
  }
  return new Response(
    Readable.toWeb(createReadStream(file, { start: answer.start, end: answer.end })) as ReadableStream,
    { status: answer.status, headers },
  )
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
