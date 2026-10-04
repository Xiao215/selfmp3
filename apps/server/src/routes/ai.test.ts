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
 * Settings › Smart features: a feature turned off is refused before anything
 * reaches the model. The model is a real endpoint on a free port that counts
 * what it is asked, so "nothing left the library" is measured, not assumed.
 */
describe('smart features turned off in Settings', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_STORAGE_DRIVER',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_CLOUD_DIR',
    'SELFMP3_AI_BASE_URL',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let config: Config
  let container: Container
  let server: http.Server
  let model: http.Server
  let origin = ''
  let asked = 0

  beforeAll(async () => {
    model = http.createServer((_request, response) => {
      asked++
      response.writeHead(200, { 'Content-Type': 'application/json' })
      const content = JSON.stringify({
        action: 'tidy',
        play: false,
        next: false,
        songs: null,
        find: null,
        stats: null,
        playlists: null,
        playlistSongs: null,
        library: null,
        open: null,
        say: null,
        try: null,
      })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))

    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-ai-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_STORAGE_DRIVER'] = 'local'
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    process.env['SELFMP3_AI_BASE_URL'] =
      `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`

    config = loadConfig()
    container = createContainer(config)
    server = http.createServer(createApp(container))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => model.close(() => resolve()))
    container.close()
    fs.rmSync(root, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const call = (method: string, url: string, body?: unknown): Promise<Response> =>
    fetch(`${origin}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('refuses each feature that is off, and asks the model nothing', async () => {
    container.settings.update({
      smartAsk: false,
      smartTidy: false,
      smartTags: false,
      smartWritten: false,
    })
    for (const [method, url, body] of [
      ['POST', '/api/ai/ask', { text: 'check my song names' }],
      ['POST', '/api/ai/describe', { text: 'calm piano', understanding: null }],
      ['GET', '/api/ai/tidy'],
      ['GET', '/api/ai/tags/untagged'],
      ['GET', '/api/ai/written?range=month'],
    ] as const) {
      const response = await call(method, url, body)
      expect(response.status, url).toBe(403)
      expect(((await response.json()) as { code: string }).code).toBe('ai_disabled')
    }
    expect(asked).toBe(0)
  })

  it('lets Ask through but not into Tidy up while Tidy up is off', async () => {
    container.settings.update({ smartAsk: true, smartTidy: false })
    const response = await call('POST', '/api/ai/ask', { text: 'check my song names' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      kind: 'none',
      say: 'Tidy up is turned off in Settings › Smart features.',
      try: [],
    })
    // The router was asked; the names pass was not.
    expect(asked).toBe(1)
  })
})
