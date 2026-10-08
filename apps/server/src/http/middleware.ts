import crypto from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN } from '@selfmp3/shared'
import type { Config, ServingConfig } from '../config.js'
import type { Logger } from '../logger.js'
import { HttpError } from './errors.js'
import { isLocalRequest } from './local.js'

/**
 * Cross-cutting middleware: request logging, auth, CORS and security headers.
 */

/**
 * Log every request once it completes, with its status and duration.
 *
 * The token travels as `?token=` on media URLs (`bearerAuth` below), so the
 * query is logged with that value blanked rather than as it came: a log is
 * read, pasted and kept, and the secret that guards the library has no place
 * in it.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
      // Range requests on a single track are noisy and uninteresting.
      const noisy = req.path.startsWith('/api/stream/') || req.path.startsWith('/api/art/')
      const line = `${req.method} ${loggedUrl(req.originalUrl)} ${res.statusCode}`
      const fields = { ms: ms.toFixed(1) }
      if (noisy) logger.debug(line, fields)
      else if (res.statusCode >= 500) logger.error(line, fields)
      else logger.info(line, fields)
    })
    next()
  }
}

/** The request's URL with the token, if it carried one, blanked. */
export function loggedUrl(originalUrl: string): string {
  const at = originalUrl.indexOf('?')
  if (at === -1) return originalUrl
  const query = new URLSearchParams(originalUrl.slice(at + 1))
  if (!query.has('token')) return originalUrl
  query.set('token', '…')
  return `${originalUrl.slice(0, at)}?${query.toString()}`
}

/**
 * Bearer-token auth.
 *
 * There is always a token: one is made on the first boot that finds none
 * (`repositories/auth.ts`) and published into the bucket beside the addresses
 * this server listens on, so every device signed in to your Google account is
 * handed it with the sync and nobody ever types it. `SELFMP3_AUTH_TOKEN` is
 * used instead when it is set.
 *
 * A request from the machine the server runs on is exempt (`local.ts`).
 * Somebody at that keyboard can open `selfmp3.db`, which holds this very token,
 * and the library folder, which holds the music — so asking them for a key they
 * could pick up protects nothing, and would make the server's own page at `/`
 * and an extension pointed at `http://localhost:4600` demand a token for no
 * gain. The token keeps the library from the network, not from its own
 * computer. What still stops a website you happen to be visiting from using
 * that exemption is `sameOriginWrites` below, and CORS for reads.
 *
 * The comparison is timing-safe. That is arguably paranoid for a single-user
 * server behind a VPN, but it costs one line and removes a whole category of
 * "well, technically" from the threat model.
 */
export function bearerAuth(config: Pick<ServingConfig, 'authToken'>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Health checks stay open so a monitor, launchd or a container HEALTHCHECK
    // does not need the secret. This is mounted at `/api`, so express has
    // already stripped that prefix from req.path — accept both spellings so the
    // exemption survives a change of mount point.
    if (req.path === '/health' || req.path === '/api/health') return next()

    if (isLocalRequest(req)) return next()
    const provided = tokenOf(req)
    if (provided === null) return next(HttpError.unauthorized())
    if (!matches(provided, config.authToken)) return next(HttpError.unauthorized('invalid token'))
    next()
  }
}

/**
 * Whether this request carried the right token, or came from this computer,
 * which needs none.
 *
 * For the routes that answer without authenticating and would still rather not
 * say everything they know to whoever asked. It has to agree with `bearerAuth`
 * about who is let in, or `/api/health` would hold back from somebody at the
 * keyboard what every other route on the same machine tells them freely — so
 * both are built from the same two pieces below.
 */
export function isAuthenticated(req: Request, config: Pick<ServingConfig, 'authToken'>): boolean {
  if (isLocalRequest(req)) return true
  const provided = tokenOf(req)
  return provided !== null && matches(provided, config.authToken)
}

/**
 * The token a request carries: `Authorization: Bearer …`, or `?token=` — the
 * <audio> element cannot send a header, so media URLs carry it in the query.
 */
function tokenOf(req: Request): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  const fromQuery = req.query['token']
  return typeof fromQuery === 'string' && fromQuery !== '' ? fromQuery : null
}

/** A timing-safe comparison of what was sent against the token. */
function matches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

/** What the origin checks read of the configuration. */
type OriginConfig = Pick<Config, 'corsOrigins' | 'publicUrl' | 'appUrl'>

/**
 * Every origin this server answers to, beyond the page it serves itself.
 *
 * Three are always here and none of them is a website: the desktop app's
 * `app://selfmp3`, the extension's, and whatever `SELFMP3_CORS_ORIGINS` names
 * by hand. The published site is the fourth, and only when `SELFMP3_PUBLIC_URL`
 * is set — a public address exists so that a device away from the house can
 * reach this server, and the app on that device is the one served from
 * `appUrl`. Allowing it is therefore not a second decision: it is what
 * the first one was for, and leaving it out would publish an address that every
 * browser then refuses to call.
 *
 * Being on this list is permission to *ask*, not to be answered: a request that
 * arrives over the public address is not from this machine (`local.ts` wants a
 * loopback host, and a tunnel forwards the real one), so it still needs the
 * token like any other.
 */
function allowedOrigins(config: OriginConfig): Set<string> {
  const origins = new Set([...config.corsOrigins, DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN])
  if (config.publicUrl) origins.add(new URL(config.appUrl).origin)
  return origins
}

/**
 * No bucket, no library.
 *
 * The bucket is the library (docs/SYNC.md) and this server keeps no copy of
 * it, so with none connected there is nothing to answer about: no songs to
 * list, nowhere for an import to go. Rather than answer with an empty library
 * that every device would take for the truth, the API says so, and only the
 * routes that connect a bucket — and the health check the page reads first —
 * are open until one is.
 */
export function requireCloud(connected: () => boolean): RequestHandler {
  const open = ['/health', '/cloud']
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (connected()) return next()
    if (open.some(prefix => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return next()
    }
    next(
      HttpError.conflict(
        'No cloud bucket is connected. The library lives in the bucket, so connect one first: ' +
          'sign in with Google on the server’s page.',
      ),
    )
  }
}

/**
 * Refuse a write that another website asked for.
 *
 * Nothing here needs a cookie, so the browser attaches no credentials of its
 * own — but on the machine running the server it answers at a predictable
 * address and asks for no token (`local.ts`), which is enough. A page you
 * happen to be visiting can submit a
 * form at `http://localhost:4600/api/songs/bulk/delete` and the browser
 * will send it: a form post is a "simple" request, so it goes without asking
 * permission first, and the reply being unreadable is no comfort once the write
 * has happened.
 *
 * What separates that from the real app is `Origin`, which browsers attach to
 * every write. A request carrying one we do not know is a page we did not
 * write, and gets nothing. A request with no `Origin` at all is not a browser —
 * the phone, `curl`, a shortcut — and is left alone; there is no browser there
 * to be tricked.
 *
 * The desktop app is one of ours, and always let through: its page is
 * served from `app://selfmp3`, which no website can claim. So is the browser
 * extension, whose origin carries an id only its own committed key produces.
 */
export function sameOriginWrites(config: OriginConfig): RequestHandler {
  const allowed = allowedOrigins(config)

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()

    // No `Origin` at all means no browser sent this — the phone, `curl`, a
    // shortcut — and there is nothing there to trick. The literal "null" is a
    // different matter: that is what a sandboxed frame sends, which is
    // something a page can put on you, so it is refused with the rest.
    const origin = req.headers.origin
    if (!origin) return next()
    if (allowed.has(origin)) return next()

    // The app served by this very server, whatever address it was reached at.
    const host = req.headers.host
    if (host && origin === `${req.protocol}://${host}`) return next()

    next(HttpError.forbidden('that request came from another site'))
  }
}

/** CORS, for every origin `allowedOrigins` names. */
export function cors(config: OriginConfig): RequestHandler {
  const allowed = allowedOrigins(config)

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin
    /*
     * On every answer, not only the ones with CORS headers. A cover the page
     * shows with a plain <img> is asked for without an Origin; without Vary the
     * browser kept that answer and gave it back to a later CORS request for
     * the same cover (saving the month as an image), which then had no
     * Access-Control-Allow-Origin and was refused.
     */
    res.setHeader('Vary', 'Origin')
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      /*
       * An audio element that plays a song from here asks with credentials —
       * `crossOrigin = 'use-credentials'`, which the player sets because the
       * Media Session API and background playback need it. A browser throws
       * that response away unless the server says credentials were allowed,
       * so an explicitly allowed origin got its library and then silence.
       *
       * Only ever sent to an origin already on the list: the desktop app's,
       * the extension's, the published site's when there is a public address,
       * and whatever `SELFMP3_CORS_ORIGINS` names by hand (`allowedOrigins`).
       */
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      /*
       * `x-selfmp3-refresh` is how the offline cache asks for the bytes
       * themselves rather than the copy the service worker would hand back.
       * A custom header makes a cross-origin request preflight, and a
       * preflight that does not name the header is refused — so keeping a
       * song failed with "Failed to fetch" and no clue as to why.
       */
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Selfmp3-Refresh',
      )
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  }
}

/**
 * Security headers.
 *
 * The server serves no app any more, only its own page (`admin.ts`) and the
 * API, so the CSP is what that page needs: its own script and stylesheet, the
 * two inline `style` attributes it draws (a field's width, the upload
 * meter), and images from anywhere for the covers the API serves. Every
 * other kind of content is the page's own or nothing.
 */
export function securityHeaders(): RequestHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    // The page wants none of these, so no script on it can ask for them.
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    next()
  }
}
