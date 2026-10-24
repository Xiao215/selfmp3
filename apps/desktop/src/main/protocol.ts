import { createReadStream, type Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { protocol } from 'electron'
import {
  APP_ORIGIN,
  APP_SCHEME,
  MEDIA_PREFIX,
  STREAM_PREFIX,
  fileKindSchema,
} from '@selfmp3/desktop-bridge'

import { answerFromDisk, fileStats } from './disk.js'
import { directoryFor } from './files.js'
import { contentTypeFor, isRoute, resolveWithinRoot } from './paths.js'
import type { StreamProxy } from './stream.js'

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

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
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

interface ProtocolRoots {
  /** `apps/app/dist`, copied into the bundle's resources by electron-builder. */
  readonly web: string
  /**
   * Metro's origin in `npm run dev:desktop`, where the page is served from
   * there instead. Null in a real app, and the media handler's allow-list is
   * the only thing that reads it.
   */
  readonly devOrigin: string | null
  /** Bucket songs not on this computer, through the doorman (`stream.ts`). */
  readonly stream: StreamProxy
}

export function handleAppScheme(roots: ProtocolRoots): void {
  protocol.handle(APP_SCHEME, async request => {
    const url = new URL(request.url)

    if (url.pathname.startsWith(MEDIA_PREFIX)) {
      return serveMedia(request, url.pathname, roots.devOrigin)
    }
    if (url.pathname.startsWith(STREAM_PREFIX)) {
      const key = bucketKey(url.pathname.slice(STREAM_PREFIX.length))
      if (key === null) return notFound()
      return roots.stream.serve(request, key, allowedOrigin(request, roots.devOrigin))
    }

    const resolved = resolveWithinRoot(roots.web, url.pathname)
    const stats = resolved === null ? null : await fileStats(resolved)
    if (resolved !== null && stats !== null) return serveWebFile(resolved, stats)

    // A route is index.html. A file the export does not have is a 404, never
    // index.html in its place — see `isRoute` for what that would hide.
    if (isRoute(url.pathname, request.headers.get('Sec-Fetch-Mode'))) {
      return serveWebFile(join(roots.web, 'index.html'))
    }
    return notFound()
  })
}

/** `known` is the stat the caller already made to find the file; a route's index.html has none. */
async function serveWebFile(file: string, known?: Stats): Promise<Response> {
  try {
    const stats = known ?? (await stat(file))
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(file),
        'Content-Length': String(stats.size),
        // The export's filenames carry a content hash, so a long cache is
        // safe; index.html is the one that must not be held, and it is
        // re-read on every launch anyway.
        'Cache-Control': file.endsWith('index.html')
          ? 'no-cache'
          : 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return notFound()
  }
}

function notFound(): Response {
  return new Response('not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
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
 * a year (`disk.ts`).
 *
 * The **CORS pair**: the engine sets `crossOrigin = 'use-credentials'` so the
 * analyser may read the samples, and that mode rejects `*`. So an origin has to
 * be named — but only ever one the page is actually served from, `app://selfmp3`
 * or Metro's in `npm run dev:desktop`. Echoing back whatever asked would let any
 * page that reaches this scheme read someone's files with credentials attached.
 */
async function serveMedia(
  request: Request,
  pathname: string,
  devOrigin: string | null,
): Promise<Response> {
  const rest = pathname.slice(MEDIA_PREFIX.length)
  const slash = rest.indexOf('/')
  const kind = fileKindSchema.safeParse(slash === -1 ? '' : rest.slice(0, slash))
  if (!kind.success) return new Response('not found', { status: 404 })

  const file = resolveWithinRoot(directoryFor(kind.data), `/${rest.slice(slash + 1)}`)
  // One stat answers both "is it a file" and "how big": a seek is a request of its own.
  const stats = file === null ? null : await fileStats(file)
  if (file === null || stats === null) return new Response('not found', { status: 404 })

  const answer = answerFromDisk(request, file, stats)
  answer.headers.set('Access-Control-Allow-Origin', allowedOrigin(request, devOrigin))
  answer.headers.set('Access-Control-Allow-Credentials', 'true')
  return answer
}

/**
 * The origin a media answer's CORS pair names: the asker's when it is one the
 * page is served from, else the app's own — never whatever asked (see
 * `serveMedia` for why).
 */
function allowedOrigin(request: Request, devOrigin: string | null): string {
  const origin = request.headers.get('Origin')
  return origin !== null && (origin === APP_ORIGIN || origin === devOrigin) ? origin : APP_ORIGIN
}

/** A bucket key out of the address, each part decoded; null for one that does not decode. */
function bucketKey(encoded: string): string | null {
  try {
    return encoded.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}
