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
 * Requests without an Origin — the Mac's server, curl — are not browsers, and
 * are served as they are. CORS protects people's browsers, not the doorman:
 * every request still has to bring its own session.
 */

const ALLOW_METHODS = 'GET, HEAD, PUT, POST, DELETE, OPTIONS'
const ALLOW_HEADERS = 'Authorization, Content-Type, Content-Encoding, Range, If-None-Match'
const EXPOSE_HEADERS = 'Content-Length, Content-Range, Content-Encoding, ETag, Accept-Ranges'
const MAX_AGE_SECONDS = '86400'

let parsed: { from: string; origins: ReadonlySet<string> } | null = null

/**
 * APP_ORIGINS as a set of origins, each tidied the way a browser sends it, so
 * a trailing slash in the setting does not lock the app out. Worked out again
 * only when the setting changes.
 */
export function allowedOrigins(value: string | undefined, log: Log): ReadonlySet<string> {
  const from = value ?? ''
  if (parsed?.from === from) return parsed.origins
  const origins = new Set<string>()
  for (const entry of from.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    try {
      origins.add(new URL(trimmed).origin)
    } catch {
      log.warn('APP_ORIGINS has an entry that is not an address; it is ignored', { entry: trimmed })
    }
  }
  parsed = { from, origins }
  return origins
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
