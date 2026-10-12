import { once } from 'node:events'
import type http from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { errorHandler } from './errors.js'
import { route } from './route.js'

/** Which side a failed parse is on: the sender's input, or this server's own work. */

const servers: http.Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function serve(): Promise<string> {
  const app = express()
  app.use(express.json())
  app.post(
    '/echo',
    route({ body: z.object({ name: z.string() }) }, ({ body }) => body),
  )
  // A reply from somewhere else that did not have the shape it should.
  app.get(
    '/upstream',
    route({}, () => z.object({ changes: z.string() }).parse({ changes: 7 })),
  )
  app.use(errorHandler(createLogger('silent')))
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('route', () => {
  it('answers an input that fails its schema with a 400 that says why', async () => {
    const base = await serve()
    const response = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 3 }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code: string; details: unknown[] }
    expect(body.code).toBe('bad_request')
    expect(body.details).toHaveLength(1)
  })

  it('answers a failed parse inside the handler as the server’s fault, not the sender’s', async () => {
    const base = await serve()
    const response = await fetch(`${base}/upstream`)
    expect(response.status).toBe(500)
    expect(((await response.json()) as { code: string }).code).toBe('internal')
  })
})
