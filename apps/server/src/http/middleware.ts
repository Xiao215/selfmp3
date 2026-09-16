import crypto from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { HttpError } from './errors.js'
import { isLocalRequest } from './local.js'

/**
 * Cross-cutting middleware: request logging, auth, CORS and security headers.
 */

/** Log every request once it completes, with its status and duration. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
      // Range requests on a single track are noisy and uninteresting.
      const noisy = req.path.startsWith('/api/stream/') || req.path.startsWith('/api/art/')
      const line = `${req.method} ${req.originalUrl} ${res.statusCode}`
      const fields = { ms: ms.toFixed(1) }
      if (noisy) logger.debug(line, fields)
      else if (res.statusCode >= 500) logger.error(line, fields)
      else logger.info(line, fields)
    })
    next()
  }
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
export function bearerAuth(config: Config): RequestHandler {
  const expected = config.authToken
  // Only reachable in a test that built a config by hand: the container settles
  // this before anything can serve. Left as a pass-through rather than a throw,
  // since a server with no token is what this used to be.
  if (!expected) return (_req, _res, next) => next()

  const expectedBuffer = Buffer.from(expected, 'utf8')

  return (req: Request, _res: Response, next: NextFunction): void => {
    // Health checks stay open so a monitor, launchd or a container HEALTHCHECK
    // does not need the secret. This is mounted at `/api`, so express has
    // already stripped that prefix from req.path — accept both spellings so the
    // exemption survives a change of mount point.
    if (req.path === '/health' || req.path === '/api/health') return next()

    if (isLocalRequest(req)) return next()

    // The <audio> element cannot send an Authorization header, so media URLs
    // accept the token as a query parameter instead.
    const header = req.headers.authorization
    const fromHeader = header?.startsWith('Bearer ') === true ? header.slice(7) : null
    const rawQueryToken = req.query['token']
    const fromQuery = typeof rawQueryToken === 'string' ? rawQueryToken : null
    const provided = fromHeader ?? fromQuery

    if (!provided) return next(HttpError.unauthorized())

    const providedBuffer = Buffer.from(provided, 'utf8')
    const ok =
      providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer)

    if (!ok) return next(HttpError.unauthorized('invalid token'))
    next()
  }
}

/**
 * Whether this request carried the right token — or came from this computer,
 * which needs none, or there is no token to carry at all.
 *
 * For the routes that answer without authenticating and would still rather not
 * say everything they know to whoever asked. It has to agree with `bearerAuth`
 * about who is let in, or `/api/health` would hold back from somebody at the
 * keyboard what every other route on the same machine tells them freely.
 */
export function isAuthenticated(req: Request, config: Config): boolean {
  const expected = config.authToken
  if (!expected) return true
  if (isLocalRequest(req)) return true

  const header = req.headers.authorization
  const fromHeader = header?.startsWith('Bearer ') === true ? header.slice(7) : null
  const rawQueryToken = req.query['token']
  const provided = fromHeader ?? (typeof rawQueryToken === 'string' ? rawQueryToken : null)
  if (provided === null) return false

  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

/**
 * Refuse a write that another website asked for.
 *
 * Nothing here needs a cookie, so the browser attaches no credentials of its
 * own — but on the machine running the server it answers at a predictable
 * address and asks for no token (`local.ts`), which is enough. A page you
 * happen to be visiting can submit a
 * form at `http://localhost:4600/api/library/purge-missing` and the browser
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
export function sameOriginWrites(config: Config): RequestHandler {
  const allowed = new Set([...config.corsOrigins, DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN])

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

/** CORS, for the origins listed in config, the desktop app's own and the extension's. */
export function cors(config: Config): RequestHandler {
  const allowed = new Set([...config.corsOrigins, DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN])

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      /*
       * An audio element that plays a song from here asks with credentials —
       * `crossOrigin = 'use-credentials'`, which the player sets because the
       * Media Session API and background playback need it. A browser throws
       * that response away unless the server says credentials were allowed,
       * so an explicitly allowed origin got its library and then silence.
       *
       * Only ever sent to an origin already on the list, which is empty
       * unless somebody set `SELFMP3_CORS_ORIGINS` on purpose. The app the
       * server serves itself is same-origin and never reaches this.
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
 * The CSP is strict but has to allow blob: and data: for cover art the client
 * builds locally, and 'unsafe-inline' for styles because the UI sets a few
 * CSS custom properties inline (progress positions, tag hues).
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
    // Let the page use the Media Session API and keep playing in the background.
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
    next()
  }
}
