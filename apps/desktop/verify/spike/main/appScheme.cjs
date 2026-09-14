/**
 * The twenty-line main process the plan's check 1 describes, shared by checks
 * 1 and 2: `app` registered as a privileged scheme, `apps/app/dist` served
 * through `protocol.handle` with `index.html` for unknown paths, and `_media/`
 * answering `Range:` with a 206 built by hand.
 *
 * `net.fetch('file://…')` ignores a `Range:` header and answers 200 with the
 * whole body, which is the finding that sends the server's range rule to
 * `packages/shared` in phase 3. Here it is done inline and crudely, because the
 * question is only whether Chromium accepts the answer.
 */
const { protocol, net } = require('electron')
const { createReadStream, statSync } = require('node:fs')
const { join, normalize, extname } = require('node:path')
const { Readable } = require('node:stream')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

function registerPrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // Deliberately off: the desktop registers no service worker.
        allowServiceWorkers: false,
      },
    },
  ])
}

/** Counts what the handler was asked for, so a check can assert on it. */
const seen = { ranges: [], statuses: [] }

function handle({ webRoot, mediaRoot, pageOrigin }) {
  protocol.handle('app', async request => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname)

    if (path.startsWith('/_media/')) {
      return media(request, mediaRoot, path.slice('/_media/'.length), pageOrigin)
    }

    const candidate = join(webRoot, normalize(path))
    const file = insideAndReal(webRoot, candidate) ? candidate : join(webRoot, 'index.html')
    const response = await net.fetch(`file://${file}`)
    const headers = new Headers(response.headers)
    headers.set('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    seen.statuses.push(response.status)
    return new Response(response.body, { status: response.status, headers })
  })
}

function insideAndReal(root, candidate) {
  if (!candidate.startsWith(root)) return false
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * `Range:` answered properly, which is what seeking needs.
 *
 * The CORS pair matters as much as the 206: the engine sets
 * `crossOrigin = 'use-credentials'` so the analyser may read the samples, and
 * that mode rejects `*`. The page's origin is echoed back instead.
 */
function media(request, mediaRoot, name, pageOrigin) {
  const file = join(mediaRoot, normalize(name))
  if (!insideAndReal(mediaRoot, file)) return new Response('not found', { status: 404 })
  const size = statSync(file).size
  const origin = request.headers.get('Origin') ?? pageOrigin

  const headers = new Headers({
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  })

  const header = request.headers.get('Range')
  seen.ranges.push(header ?? null)
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match) {
    headers.set('Content-Length', String(size))
    seen.statuses.push(200)
    return new Response(Readable.toWeb(createReadStream(file)), { status: 200, headers })
  }

  const [, rawStart, rawEnd] = match
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (start > end || start >= size) {
    headers.set('Content-Range', `bytes */${size}`)
    seen.statuses.push(416)
    return new Response(null, { status: 416, headers })
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(end - start + 1))
  seen.statuses.push(206)
  return new Response(Readable.toWeb(createReadStream(file, { start, end })), { status: 206, headers })
}

module.exports = { registerPrivileged, handle, seen, MIME }
