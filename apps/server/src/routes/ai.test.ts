import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig, type ServingConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * Settings › Smart features: turned off, every smart feature is refused before
 * anything reaches the model. The model is a real endpoint on a free port that counts
 * what it is asked, so "nothing left the library" is measured, not assumed.
 */
describe('smart features turned off in Settings', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_CLOUD_DIR',
    'SELFMP3_AI_BASE_URL',
  ] as const
  const saved = new Map<string, string | undefined>()
  let root = ''
  let config: ServingConfig
  let container: Container
  let server: http.Server
  let model: http.Server
  let origin = ''
  let asked = 0
  /** How long the model takes to answer. */
  let thinkingMs = 0
  /** What the model says about an import's names. */
  let importReply: unknown[] = []
  /** What the router chooses for an Ask: a whole names checkup unless a test says otherwise. */
  let routeReply: { action: string; say: string | null; tidy: unknown } = {
    action: 'tidy',
    say: null,
    tidy: { what: 'checkup', lookUp: false },
  }

  beforeAll(async () => {
    model = http.createServer(async (request, response) => {
      asked++
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const task = (JSON.parse(body) as { response_format: { json_schema: { name: string } } })
        .response_format.json_schema.name
      await new Promise(resolve => setTimeout(resolve, thinkingMs))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      if (task === 'import-names') {
        const content = JSON.stringify({ rows: importReply })
        response.end(JSON.stringify({ choices: [{ message: { content } }] }))
        return
      }
      const content = JSON.stringify({
        action: routeReply.action,
        filters: null,
        songs: null,
        change: null,
        reply: null,
        tags: null,
        playback: null,
        find: null,
        stats: null,
        playlists: null,
        playlistSongs: null,
        library: null,
        tidy: routeReply.tidy,
        remember: null,
        getMusic: null,
        open: null,
        say: routeReply.say,
        try: null,
      })
      response.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
    await new Promise<void>(resolve => model.listen(0, '127.0.0.1', resolve))

    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-ai-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    process.env['SELFMP3_AI_BASE_URL'] =
      `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`

    container = createContainer(loadConfig())
    config = container.config
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
        Authorization: `Bearer ${config.authToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  it('refuses every feature while smart features are off, and asks the model nothing', async () => {
    container.settings.update({ smartFeatures: false })
    for (const [method, url, body] of [
      ['POST', '/api/ai/ask', { text: 'check my song names' }],
      ['POST', '/api/ai/describe', { text: 'calm piano', understanding: null }],
      ['GET', '/api/ai/tidy'],
      ['GET', '/api/ai/tags/untagged'],
      ['GET', '/api/ai/written?range=month'],
      ['GET', '/api/ai/songs/1/metadata'],
      ['POST', '/api/ai/import/names', { list: null, rows: [{ title: 'x' }] }],
    ] as const) {
      const response = await call(method, url, body)
      expect(response.status, url).toBe(403)
      expect(((await response.json()) as { code: string }).code).toBe('ai_disabled')
    }
    expect(asked).toBe(0)
    container.settings.update({ smartFeatures: true })
  })

  it('goes on with an Ask whose connection closed, and keeps its answer under the ticket', async () => {
    routeReply = { action: 'none', say: 'Nothing to change.', tidy: null }
    thinkingMs = 300
    const ticket = 'phone-went-away-1'
    const hangUp = new AbortController()
    const asking = fetch(`${origin}/api/ai/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.authToken}` },
      // Words of its own: the router's answer to the last ones is remembered.
      body: JSON.stringify({ text: 'check my album names', ticket }),
      signal: hangUp.signal,
    })
    // The app is sent to the background and its connection goes while the model thinks.
    await new Promise(resolve => setTimeout(resolve, 100))
    hangUp.abort()
    await expect(asking).rejects.toThrow()

    let progress: { done: boolean; answer: unknown; failed: unknown } | undefined
    for (let tries = 0; tries < 40 && !progress?.done; tries++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      progress = (await (
        await call('GET', `/api/ai/ask/progress?ticket=${ticket}&answer=1`)
      ).json()) as typeof progress
    }
    thinkingMs = 0
    expect(progress).toMatchObject({
      done: true,
      failed: null,
      answer: { kind: 'none', say: 'Nothing to change.' },
    })
  })

  it('reads an import’s names, and keeps only the words the rows already had', async () => {
    importReply = [
      // The artist out of the title, the channel's name let go of.
      { n: 1, title: 'アイドル', artist: 'YOASOBI', album: '', why: 'Artist was in the title' },
      // A name the row never had: refused, so nothing is left to suggest.
      { n: 2, title: 'Idol', artist: 'YOASOBI', album: '', why: 'English title' },
    ]
    const response = await call('POST', '/api/ai/import/names', {
      list: 'YOASOBI hits',
      rows: [
        { title: 'YOASOBI「アイドル」', artist: 'Ayase Official', duration: 213 },
        { title: 'アイドル', artist: 'YOASOBI', duration: 213 },
      ],
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      suggestions: [
        {
          row: 0,
          title: 'アイドル',
          artist: 'YOASOBI',
          album: '',
          why: 'Artist was in the title',
        },
      ],
    })
  })

  it('says it does not know a ticket it never saw', async () => {
    const response = await call('GET', '/api/ai/ask/progress?ticket=never-asked-1')
    expect(await response.json()).toEqual({
      steps: [],
      known: false,
      done: false,
      answer: null,
      failed: null,
    })
  })
})
