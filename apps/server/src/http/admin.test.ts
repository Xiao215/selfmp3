import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { createContainer, type Container } from '../container.js'
import { PUBLIC_DIR } from './admin.js'

/**
 * The server's own page, asked for over HTTP the way a browser asks.
 *
 * It is mounted last and answers every path the API did not, so the thing worth
 * proving is the seam: the page must not swallow an API path, and the API's own
 * 404 must still be JSON. Both fail quietly otherwise — a client asking for
 * `/api/something` would be handed a web page and report that the server had
 * lost its mind, rather than that a route was missing.
 */
describe('the server serves its own page', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_STORAGE_DRIVER',
    'SELFMP3_LOG_LEVEL',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let config: Config
  let container: Container
  let server: http.Server
  let origin = ''

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-admin-'))
    // Set in the shell, so they win over whatever a `.env` on this machine says.
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_STORAGE_DRIVER'] = 'local'
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'

    config = loadConfig()
    container = createContainer(config)
    server = http.createServer(createApp(container))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
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

  const get = (url: string): Promise<Response> =>
    fetch(`${origin}${url}`, {
      headers: config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {},
    })

  it('answers the root with the page, and asks for its two files', async () => {
    const response = await get('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('/admin.css')
    expect(html).toContain('/admin.js')
  })

  it.each([
    ['/admin.css', 'text/css'],
    ['/admin.js', 'javascript'],
  ])('serves %s', async (url, type) => {
    const response = await get(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(type)
  })

  /*
   * A sign-in coming back from the doorman may land on any path, so every path
   * that is not the API's is the page rather than a 404.
   */
  it.each(['/settings', '/deep/and/unknown'])('answers %s with the page too', async url => {
    const response = await get(url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('leaves the API alone, 404s included', async () => {
    const health = await get('/api/health')
    expect(health.status).toBe(200)
    expect(health.headers.get('content-type')).toContain('application/json')

    const missing = await get('/api/no-such-route')
    expect(missing.status).toBe(404)
    // JSON, not the page: a client must be told a route is missing, not handed HTML.
    expect(missing.headers.get('content-type')).toContain('application/json')
  })

  it('is never cached, so an updated server is never behind a stale page', async () => {
    for (const url of ['/', '/admin.js']) {
      const response = await get(url)
      expect(response.headers.get('cache-control')).toContain('no-cache')
    }
  })

  it('ships the three files it serves', () => {
    for (const name of ['admin.html', 'admin.css', 'admin.js']) {
      expect(fs.existsSync(path.join(PUBLIC_DIR, name))).toBe(true)
    }
  })
})
