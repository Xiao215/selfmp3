import type { Log } from './context.js'
import { errorResponse, forbidden } from './http.js'

/**
 * CORS, for the web app.
 *
 * A browser may call the doorman only from an address in APP_ORIGINS. Those
 * get their own origin named back on every answer, with `Vary: Origin` so no
 * cache gives one origin's answer to another. A page anywhere else gets no
 * CORS headers, so its browser keeps the answer from it, and its preflight is
 * refused outright.
 *
 * Requests without an Origin — the self.mp3 server, curl — are not browsers, and
 * are served as they are. CORS protects people's browsers, not the doorman:
 * every request still has to bring its own session.
 */

const ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE, OPTIONS'
const ALLOW_HEADERS = 'Authorization, Content-Type, Content-Encoding, Range, If-None-Match'
const EXPOSE_HEADERS = 'Content-Length, Content-Range, Content-Encoding, ETag, Accept-Ranges'
const MAX_AGE_SECONDS = '86400'

let parsed: { from: string; origins: ReadonlySet<string> } | null = null

/**
 * Schemes a browser hands out itself, which no installed app's page is served
 * from. An entry with one of these is a mistake, and is dropped rather than
 * allowed.
 */
const BROWSER_SCHEMES = new Set([
  'ws:',
  'wss:',
  'ftp:',
  'file:',
  'blob:',
  'data:',
  'about:',
  'javascript:',
  'mailto:',
])

/**
 * APP_ORIGINS as a set of origins, each tidied the way a browser sends it, so
 * a trailing slash in the setting does not lock the app out. Worked out again
 * only when the setting changes.
 *
 * Two kinds of entry. A web address, whose origin is what the browser sends.
 * And an installed app's own scheme — `app://selfmp3`, the desktop app's page —
 * which a browser sends exactly as written, a made-up scheme having no origin
 * rules of its own. Those are kept verbatim, lowercased, and only written as
 * bare `scheme://host`: with a path, a query, or nothing after the slashes it
 * is a mistake, not an app.
 */
export function allowedOrigins(value: string | undefined, log: Log): ReadonlySet<string> {
  const from = value ?? ''
  if (parsed?.from === from) return parsed.origins
  const origins = new Set<string>()
  for (const entry of from.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const origin = originOf(trimmed)
    if (origin === null) {
      log.warn('APP_ORIGINS has an entry that is not an address; it is ignored', { entry: trimmed })
    } else {
      origins.add(origin)
    }
  }
  parsed = { from, origins }
  return origins
}

function originOf(entry: string): string | null {
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    return null
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
  /*
   * A URL with any other scheme reports its origin as the string "null" —
   * which is also what a browser sends from a sandboxed frame, so one mistyped
   * entry here would have put every opaque context on the list. So the origin
   * is built by hand, from a host that has to be there and nothing that must
   * not be.
   */
  if (BROWSER_SCHEMES.has(url.protocol)) return null
  const bare =
    url.host !== '' &&
    (url.pathname === '' || url.pathname === '/') &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  return bare ? `${url.protocol}//${url.host}`.toLowerCase() : null
}

/** The answer to a preflight: yes for the app's own addresses, no for anyone else's. */
export function preflight(request: Request, origins: ReadonlySet<string>): Response {
  const origin = request.headers.get('origin')
  if (origin === null) {
    return new Response(null, { status: 204, headers: { allow: ALLOW_METHODS } })
  }
  if (!origins.has(origin)) {
    const response = errorResponse(forbidden('this address may not use the doorman'))
    response.headers.set('vary', 'Origin')
    return response
  }
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': ALLOW_METHODS,
      'access-control-allow-headers': ALLOW_HEADERS,
      'access-control-max-age': MAX_AGE_SECONDS,
      vary: 'Origin',
    },
  })
}

/**
 * Add CORS headers to an answer, in place. Every response here was made by
 * the doorman, so its headers can be changed; rebuilding it would lose the
 * `encodeBody: 'manual'` a passed-through file depends on.
 */
export function withCors(request: Request, response: Response, origins: ReadonlySet<string>): void {
  const vary = response.headers.get('vary')
  if (!vary) response.headers.set('vary', 'Origin')
  else if (!/\borigin\b/i.test(vary)) response.headers.set('vary', `${vary}, Origin`)

  const origin = request.headers.get('origin')
  if (origin === null || !origins.has(origin)) return
  response.headers.set('access-control-allow-origin', origin)
  response.headers.set('access-control-expose-headers', EXPOSE_HEADERS)
}

/** A browser page on some other address, trying to change something. */
export function isForeignWrite(request: Request, origins: ReadonlySet<string>): boolean {
  const origin = request.headers.get('origin')
  const reads = request.method === 'GET' || request.method === 'HEAD'
  return origin !== null && !origins.has(origin) && !reads && request.method !== 'OPTIONS'
}
