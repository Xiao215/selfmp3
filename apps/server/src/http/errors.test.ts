import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '../logger.js'
import { errorHandler, HttpError } from './errors.js'

describe('errorHandler', () => {
  /** The level each thrown error's own line was at, beside the request line. */
  async function levelsOf(errors: readonly HttpError[]): Promise<string[]> {
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () => logger,
    }
    const app = express()
    errors.forEach((error, n) =>
      app.get(`/${n}`, () => {
        throw error
      }),
    )
    app.use(errorHandler(logger))
    const server = app.listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      for (const [n] of errors.entries()) await (await fetch(`${origin}/${n}`)).arrayBuffer()
    } finally {
      server.close()
    }
    return errors.map(
      error =>
        (['debug', 'info', 'warn', 'error'] as const).find(level =>
          vi.mocked(logger[level]).mock.calls.some(([message]) => message === error.message),
        ) ?? 'none',
    )
  }

  it('keeps warn for a refusal, and puts an expected miss at debug', async () => {
    expect(
      await levelsOf([
        HttpError.notFound('no lyrics for this track'),
        new HttpError(404, 'this song has not been analysed yet', 'not-analysed'),
        HttpError.badRequest('that is not a song id'),
        HttpError.forbidden('that request came from another site'),
        HttpError.conflict('not connected to a bucket'),
        new HttpError(502, 'the model did not answer', 'unreachable'),
      ]),
    ).toEqual(['debug', 'debug', 'warn', 'warn', 'warn', 'error'])
  })
})
