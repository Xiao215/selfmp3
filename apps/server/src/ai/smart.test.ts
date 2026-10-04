import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { llmFor, setupFor, SmartFeatures } from './smart.js'

const logger = createLogger('silent')

function config(baseUrl: string | null) {
  return {
    ai: { baseUrl, apiKey: 'secret', modelFast: 'haiku', modelSmart: 'sonnet', timeoutSeconds: 30 },
  }
}

function smartFor(baseUrl: string | null): SmartFeatures {
  const settings = config(baseUrl)
  return new SmartFeatures({
    llm: llmFor(settings, logger),
    setup: setupFor(settings),
    songs: () => [],
    tags: () => [],
    stats: () => {
      throw new Error('not asked')
    },
    lyrics: () => [],
  })
}

let server: Server | null = null
afterEach(async () => {
  await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined)))
  server = null
})

/** A real endpoint on a free port, answering every chat call with `content`. */
async function endpoint(status: number, content: string): Promise<string> {
  server = createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
}

describe('setupFor', () => {
  it('shows the address without credentials or a query, and the two tiers', () => {
    expect(setupFor(config('https://me:pw@models.example.com/v1?key=abc'))).toEqual({
      address: 'https://models.example.com/v1',
      models: { fast: 'haiku', smart: 'sonnet' },
    })
  })

  it('says off with no address', () => {
    expect(setupFor(config(null)).address).toBeNull()
  })
})

describe('SmartFeatures.check', () => {
  it('passes when the model answers in the schema', async () => {
    const check = await smartFor(await endpoint(200, '{"ok": true}')).check()
    expect(check).toMatchObject({ ok: true, model: 'haiku' })
  })

  it('names an endpoint that is not listening, with the system’s own reason', async () => {
    const free = await endpoint(200, '')
    await new Promise(resolve => server!.close(resolve))
    server = null
    const check = await smartFor(free).check()
    expect(check).toMatchObject({
      ok: false,
      failure: 'unreachable',
      message: 'Your server couldn’t reach the model.',
    })
    expect(check.ok ? '' : check.detail).toContain(free)
  })

  it('tells a refused key from an endpoint that is down', async () => {
    const check = await smartFor(await endpoint(401, 'bad key')).check()
    expect(check).toMatchObject({ ok: false, failure: 'refused' })
  })

  it('says off when no address is set', async () => {
    expect(await smartFor(null).check()).toMatchObject({ ok: false, failure: 'off' })
  })
})
