import Database from 'better-sqlite3'
import type { NextFunction, Request, Response } from 'express'
import { API_ERROR, messageOf, type EditRefusal } from '@selfmp3/shared'
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

  /** An edit refused by the rules every answerer shares (shared editRules.ts). */
  static refused(refusal: EditRefusal): HttpError {
    return new HttpError(refusal.status, refusal.message, refusal.code)
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

    const message = messageOf(error)

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

    /*
     * The database refusing a write is not a bug in the handler, and a 500
     * said only "internal error": a full disk and a lock held from outside
     * are each said for what they are, so the app can tell the person.
     */
    const trouble = databaseTrouble(error)
    if (trouble === 'full') {
      logger.error('the disk holding the database is full', { path: req.path, message })
      res.status(507).json({ error: DISK_FULL_MESSAGE, code: API_ERROR.diskFull })
      return
    }
    if (trouble === 'busy') {
      logger.warn('the database is held by something else', { path: req.path, message })
      res.set('Retry-After', String(BUSY_RETRY_AFTER_S))
      res.status(503).json({ error: DATABASE_BUSY_MESSAGE, code: API_ERROR.databaseBusy })
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

const DISK_FULL_MESSAGE = 'the server’s disk is full'
const DATABASE_BUSY_MESSAGE = 'the server is busy, try again in a moment'
const BUSY_RETRY_AFTER_S = 2

/**
 * What a SQLite error says about the disk or the lock rather than the
 * request: `full` for no room left on the disk (SQLITE_FULL), `busy` for a
 * lock held by another connection (SQLITE_BUSY, SQLITE_LOCKED and their
 * extended codes).
 */
function databaseTrouble(error: unknown): 'full' | 'busy' | null {
  if (!(error instanceof Database.SqliteError)) return null
  if (error.code === 'SQLITE_FULL') return 'full'
  if (error.code.startsWith('SQLITE_BUSY') || error.code.startsWith('SQLITE_LOCKED')) return 'busy'
  return null
}

/** The status an error carries, for the middleware that sets one (body-parser does). */
function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown; statusCode?: unknown }).status
  if (typeof status === 'number') return status
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : null
}
