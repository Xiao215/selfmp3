import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import type { Logger } from '../logger.js'

/**
 * One error type for the whole server.
 *
 * Handlers throw `HttpError.notFound(...)` and the single error middleware
 * below turns it into a response. Nothing else formats an error body, so the
 * shape the client sees is guaranteed to match `ErrorBodySchema`.
 */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, message: string, code: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: unknown): HttpError {
    return new HttpError(400, message, 'bad_request', details)
  }

  static unauthorized(message = 'authentication required'): HttpError {
    return new HttpError(401, message, 'unauthorized')
  }

  static forbidden(message: string): HttpError {
    return new HttpError(403, message, 'forbidden')
  }

  static notFound(message = 'not found'): HttpError {
    return new HttpError(404, message, 'not_found')
  }

  static conflict(message: string): HttpError {
    return new HttpError(409, message, 'conflict')
  }

  static unprocessable(message: string, details?: unknown): HttpError {
    return new HttpError(422, message, 'unprocessable', details)
  }

  static failedDependency(message: string): HttpError {
    return new HttpError(424, message, 'failed_dependency')
  }

  static internal(message = 'internal error'): HttpError {
    return new HttpError(500, message, 'internal')
  }
}

/** Turn a zod failure into something a human can act on. */
export function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const where = issue.path.join('.')
      return where ? `${where}: ${issue.message}` : issue.message
    })
    .join('; ')
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'no such endpoint', code: 'not_found' })
}

/**
 * The final error middleware. Express identifies it by its four parameters,
 * so `_next` must stay even though it is unused.
 */
export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    if (res.headersSent) {
      // The response is already streaming; all we can do is cut it off.
      res.end()
      return
    }

    if (error instanceof ZodError) {
      const message = formatZodError(error)
      logger.warn('request failed validation', { path: req.path, message })
      res.status(400).json({ error: message, code: 'bad_request', details: error.issues })
      return
    }

    if (error instanceof HttpError) {
      // 4xx is the client's problem and is not worth an error-level log line.
      const log = error.status >= 500 ? logger.error : logger.warn
      log(error.message, { path: req.path, status: error.status })
      res.status(error.status).json({
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      })
      return
    }

    const message = error instanceof Error ? error.message : String(error)

    /*
     * A body the JSON parser could not read is the sender's mistake, not ours:
     * body-parser says so by putting a 4xx on the error it throws, and saying
     * 500 instead would have the sender retry something that can never work.
     */
    const status = statusOf(error)
    if (status !== null && status >= 400 && status < 500) {
      logger.warn('malformed request body', { path: req.path, message })
      res.status(status).json({ error: 'that request body could not be read', code: 'bad_request' })
      return
    }

    logger.error('unhandled error', {
      path: req.path,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    res.status(500).json({ error: 'internal error', code: 'internal' })
  }
}

/** The status an error carries, for the middleware that sets one (body-parser does). */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown; statusCode?: unknown }).status
  if (typeof status === 'number') return status
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : null
}
