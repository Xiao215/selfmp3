import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * Cover art from a data directory inside a hidden folder.
 *
 * `res.sendFile` refuses any path with a dot-segment unless told otherwise, and
 * answered 404 for every cover: the server's own default data directory on
 * Linux is `~/.local/share/selfmp3`, and a test lane's was `~/.selfmp3-lanes/…`.
 */
describe('GET /api/art/:id', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_STORAGE_DRIVER',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_SERVE_WEB',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let config: Config
  let container: Container
  let server: http.Server
  let origin = ''

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-art-'))
    // Set in the shell, so they win over whatever a `.env` on this machine says.
    process.env['SELFMP3_DATA_DIR'] = path.join(root, '.hidden', 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_STORAGE_DRIVER'] = 'local'
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    process.env['SELFMP3_SERVE_WEB'] = 'false'

    config = loadConfig()
    container = createContainer(config)
    const cover = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#2040c0' },
    })
      .png()
      .toBuffer()
    await container.covers.save(1, cover, '.png')

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

  it('serves the cover itself', async () => {
    const response = await get('/api/art/1')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/png')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  it('serves a thumbnail made beside it', async () => {
    const response = await get('/api/art/1?size=64')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/jpeg')
  })

  /*
   * The week-long cache header used to be set before the file was sent, so a
   * failure carried it too: the desktop app's cache kept a 404 for every cover
   * and went on serving itself that after the server could answer.
   */
  it('does not let a cover that failed to send be cached', async () => {
    // Found by name, but a directory: the send itself fails.
    fs.mkdirSync(path.join(config.dataDir, 'covers', '2.png'), { recursive: true })
    const response = await get('/api/art/2')
    expect(response.status).not.toBe(200)
    // Without a max-age a browser keeps no failure; Express's own weak ETag on
    // the JSON error body does not change that.
    expect(response.headers.get('cache-control') ?? '').not.toContain('max-age')
  })
})
