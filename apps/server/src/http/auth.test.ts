import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * Who the server lets in, asked over a real socket.
 *
 * The whole point of this is what the connection *is*, not what the request
 * says it is — so a test that matched a regex against a made-up address would
 * prove nothing. Everything here goes through express, over TCP, the way a
 * client actually arrives.
 *
 * Two cases are worth the most care, because each turns the fix back into a
 * hole if it ever goes green the wrong way. `trust proxy` is set for
 * `tailscale serve`, so express reads `req.ip` out of `X-Forwarded-For` —
 * anyone on the network could claim to be 127.0.0.1. And `tailscale serve`
 * itself connects from 127.0.0.1, so the peer address alone would wave through
 * every request from the tailnet: exactly the remote case the token is for.
 *
 * `node:http` rather than `fetch`, because the second of those needs a `Host`
 * header of its own choosing and `fetch` will not send one.
 */
describe('reaching the API', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_STORAGE_DRIVER',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_AUTH_TOKEN',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let config: Config
  let container: Container
  let server: http.Server
  let port = 0

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-auth-'))
    // Set in the shell, so they win over whatever a `.env` on this machine says.
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_STORAGE_DRIVER'] = 'local'
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    // Nothing chosen by hand: the first-boot path every installation takes.
    delete process.env['SELFMP3_AUTH_TOKEN']

    container = createContainer(loadConfig())
    config = container.config
    server = http.createServer(createApp(container))
    // Every interface, so a request can arrive from somewhere that is not
    // loopback without the test having to invent an address.
    await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    container.close()
    fs.rmSync(root, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  /** One GET, with the connection and the headers said separately. */
  function get(options: {
    connectTo: string
    url?: string
    headers?: Record<string, string>
  }): Promise<{ status: number; body: string }> {
    const { connectTo, url = '/api/library', headers = {} } = options
    return new Promise((resolve, reject) => {
      const request = http.request(
        { host: connectTo, port, path: url, method: 'GET', headers },
        response => {
          let body = ''
          response.setEncoding('utf8')
          response.on('data', chunk => (body += chunk))
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
        },
      )
      request.on('error', reject)
      request.end()
    })
  }

  const bearer = (): Record<string, string> => ({
    authorization: `Bearer ${config.authToken ?? ''}`,
  })

  /** A real address of this machine that is not loopback, if it has one. */
  const lanAddress = Object.values(os.networkInterfaces())
    .flatMap(found => found ?? [])
    .find(address => address.family === 'IPv4' && !address.internal)?.address

  it('has a token without anyone setting one', () => {
    expect(config.authToken).not.toBeNull()
    // 32 bytes as base64url: nothing in it needs escaping in a query string.
    expect(config.authToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('keeps the same token across a restart, from the database', () => {
    const second = createContainer(loadConfig())
    try {
      expect(second.config.authToken).toBe(config.authToken)
    } finally {
      second.close()
    }
  })

  it('does not ask this computer for it', async () => {
    expect((await get({ connectTo: '127.0.0.1' })).status).toBe(200)
    expect(
      (await get({ connectTo: '127.0.0.1', headers: { host: `localhost:${port}` } })).status,
    ).toBe(200)
  })

  /*
   * `trust proxy` makes `req.ip` whatever the header says, so these arrive on a
   * real socket while claiming to be local. The socket underneath is the truth.
   */
  it('is not fooled by a request that claims to have come from here', async () => {
    for (const forged of [
      { 'x-forwarded-for': '127.0.0.1' },
      { 'x-forwarded-for': '::1' },
      { 'x-forwarded-for': '10.0.0.9, 127.0.0.1' },
      { forwarded: 'for=127.0.0.1' },
    ]) {
      const response = await get({ connectTo: '127.0.0.1', headers: forged })
      expect(response.status, JSON.stringify(forged)).toBe(401)
    }
  })

  /*
   * The shape of a request through `tailscale serve`: it accepts the connection
   * from the tailnet and opens its own to 127.0.0.1, so the peer address is
   * loopback — but the phone asked for the tailnet name, and that is what
   * arrives in `Host`.
   */
  it('is not fooled by a proxy that connects from here on behalf of the tailnet', async () => {
    const response = await get({
      connectTo: '127.0.0.1',
      headers: { host: 'mac.tail1234.ts.net' },
    })
    expect(response.status).toBe(401)

    const withToken = await get({
      connectTo: '127.0.0.1',
      headers: { host: 'mac.tail1234.ts.net', ...bearer() },
    })
    expect(withToken.status).toBe(200)
  })

  it('is not fooled by a host that merely starts with a loopback name', async () => {
    const response = await get({
      connectTo: '127.0.0.1',
      headers: { host: `localhost.evil.example:${port}` },
    })
    expect(response.status).toBe(401)
  })

  /*
   * What the fix is for: another machine on the same Wi-Fi, which until now got
   * the whole library with no credentials at all. Skipped on a host with no
   * network address of its own, where there is nothing to ask from.
   */
  it.skipIf(lanAddress === undefined)('refuses the network without the token', async () => {
    const response = await get({ connectTo: lanAddress ?? '' })
    expect(response.status).toBe(401)
  })

  it.skipIf(lanAddress === undefined)('lets the network in with the token', async () => {
    const header = await get({ connectTo: lanAddress ?? '', headers: bearer() })
    expect(header.status).toBe(200)

    // The <audio> element cannot send a header, so the query parameter has to
    // work the same way — and the token has to survive being put in a URL.
    const query = await get({
      connectTo: lanAddress ?? '',
      url: `/api/library?token=${encodeURIComponent(config.authToken ?? '')}`,
    })
    expect(query.status).toBe(200)
  })

  it.skipIf(lanAddress === undefined)('refuses the network with the wrong token', async () => {
    const response = await get({
      connectTo: lanAddress ?? '',
      headers: { authorization: 'Bearer not-the-token' },
    })
    expect(response.status).toBe(401)
  })

  /*
   * A monitor, launchd or the container's HEALTHCHECK gets an answer with no
   * token — but only the part that describes the service. Where the music is
   * and how much of it there is describe the library, and are held back.
   */
  it('answers health to anyone, and says more to this computer', async () => {
    const here = JSON.parse(
      (await get({ connectTo: '127.0.0.1', url: '/api/health' })).body,
    ) as Record<string, unknown>
    expect(here['ok']).toBe(true)
    expect(here['libraryPath']).toBeTypeOf('string')

    const proxied = JSON.parse(
      (
        await get({
          connectTo: '127.0.0.1',
          url: '/api/health',
          headers: { host: 'mac.tail1234.ts.net' },
        })
      ).body,
    ) as Record<string, unknown>
    expect(proxied['ok']).toBe(true)
    expect(proxied['libraryPath']).toBeUndefined()
  })

  /*
   * The server's own page is served outside `/api` and was never behind the
   * token, but everything it shows is — and it has to work on the machine it is
   * running on without anybody typing anything.
   */
  it('serves its own page and answers what the page asks it', async () => {
    expect((await get({ connectTo: '127.0.0.1', url: '/' })).status).toBe(200)
    expect((await get({ connectTo: '127.0.0.1', url: '/api/cloud' })).status).toBe(200)
  })
})
