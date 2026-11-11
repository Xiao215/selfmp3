import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it, vi } from 'vitest'
import { createLogger, type Logger } from '../logger.js'
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

  /*
   * body-parser puts the 4xx on what it throws, as `status` and `statusCode`;
   * other middleware sets only one of the two.
   */
  it('answers a body the sender got wrong with the 4xx its error carries', async () => {
    const app = express()
    app.use(express.json({ limit: '10b' }))
    app.post('/', () => {
      throw new Error('a body was read')
    })
    app.get('/status-code', () => {
      throw Object.assign(new Error('only a statusCode'), { statusCode: 415 })
    })
    app.get('/server-side', () => {
      throw Object.assign(new Error('a 5xx on the error'), { status: 503 })
    })
    app.use(errorHandler(createLogger('silent')))
    const server = app.listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const post = (body: string) =>
        fetch(origin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const answers = [
        await post('{not json'),
        await post(JSON.stringify({ name: 'far more than ten bytes' })),
        await fetch(`${origin}/status-code`),
        await fetch(`${origin}/server-side`),
      ]
      expect(answers.map(answer => answer.status)).toEqual([400, 413, 415, 500])
      const codes = await Promise.all(
        answers.map(async answer => ((await answer.json()) as { code: string }).code),
      )
      expect(codes).toEqual(['bad_request', 'bad_request', 'bad_request', 'internal'])
    } finally {
      server.close()
    }
  })
})
