import crypto from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { HttpError } from './errors.js'

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
 * Optional bearer-token auth.
 *
 * The comparison is timing-safe. That is arguably paranoid for a single-user
 * server behind a VPN, but it costs one line and removes a whole category of
 * "well, technically" from the threat model.
 */
export function bearerAuth(config: Config): RequestHandler {
  const expected = config.authToken
  if (!expected) return (_req, _res, next) => next()

  const expectedBuffer = Buffer.from(expected, 'utf8')

  return (req: Request, _res: Response, next: NextFunction): void => {
    // Health checks stay open so a monitor does not need the secret.
    if (req.path === '/api/health') return next()

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

/** CORS, but only for origins explicitly listed in config. */
export function cors(config: Config): RequestHandler {
  const allowed = new Set(config.corsOrigins)
  if (allowed.size === 0) return (_req, _res, next) => next()

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
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
