import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { darkPalette, lightPalette } from '@selfmp3/client/tokens'
import { AdminDataSchema, DoormanAccessSchema, ErrorBodySchema } from '@selfmp3/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createHubApp } from '../hub/app.js'
import { Hub } from '../hub/hub.js'
import { createLogger } from '../logger.js'
import { ADMIN_DIR, createAdminApp } from './app.js'

/**
 * The owner's admin page and the public port, asked over HTTP the way a
 * browser and a device ask: the page lives on its own listener, the public
 * port serves the API and nothing else, and what a device reports reaches the
 * page as a total.
 */
describe('the admin page', () => {
  const variables = [
    'SELFMP3_DATA_DIR',
    'SELFMP3_LIBRARY_DIR',
    'SELFMP3_LOG_LEVEL',
    'SELFMP3_CLOUD_DIR',
    'SELFMP3_ADMIN_URL',
    'SELFMP3_AI_BASE_URL',
    'SELFMP3_DOORMAN_URL',
    'SELFMP3_DOORMAN_ADMIN_TOKEN',
  ] as const
  const KEY = 'k'.repeat(64)
  /** The doorman, stood in for at its HTTP edge: it takes the admin key and nothing else. */
  let list = {
    anyone: false,
    emails: ['friend@example.com'],
    owners: ['me@example.com'],
    profiles: {},
  }
  const doormanSeen: Array<{ method: string; path: string; auth: string }> = []
  const fakeDoorman = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://doorman')
    doormanSeen.push({
      method: req.method ?? '',
      path: url.pathname,
      auth: req.headers.authorization ?? '',
    })
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${KEY}`)
      return json(401, { error: 'no', code: 'unauthorized' })
    if (url.pathname === '/v1/stats') {
      return json(200, {
        days: [{ day: new Date().toISOString().slice(0, 10), counts: { 'reads.audio': 5 } }],
      })
    }
    if (url.pathname === '/v1/access' && req.method === 'PUT') {
      let body = ''
      req.on('data', chunk => (body += String(chunk)))
      req.on('end', () => {
        list = { ...list, ...(JSON.parse(body) as { anyone: boolean; emails: string[] }) }
        json(200, list)
      })
      return
    }
    if (url.pathname === '/v1/access') return json(200, list)
    json(404, { error: 'no', code: 'not_found' })
  })
  let doormanOrigin = ''
  const saved = new Map<string, string | undefined>()
  let root = ''
  let hub: Hub
  let admin: http.Server
  let api: http.Server
  let adminOrigin = ''
  let apiOrigin = ''

  const listen = async (server: http.Server): Promise<string> => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  beforeAll(async () => {
    for (const name of variables) saved.set(name, process.env[name])
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-admin-'))
    process.env['SELFMP3_DATA_DIR'] = path.join(root, 'data')
    process.env['SELFMP3_LIBRARY_DIR'] = path.join(root, 'library')
    process.env['SELFMP3_LOG_LEVEL'] = 'silent'
    // The API answers nothing without a bucket; a folder stands in for one.
    process.env['SELFMP3_CLOUD_DIR'] = 'bucket'
    process.env['SELFMP3_ADMIN_URL'] = 'https://pi.example.ts.net:4443'
    delete process.env['SELFMP3_AI_BASE_URL']
    doormanOrigin = await listen(fakeDoorman)
    process.env['SELFMP3_DOORMAN_URL'] = doormanOrigin
    process.env['SELFMP3_DOORMAN_ADMIN_TOKEN'] = KEY

    const config = loadConfig()
    hub = new Hub(config, createLogger('silent'), null)
    hub.start()
    admin = http.createServer(createAdminApp(hub))
    api = http.createServer(createHubApp(hub))
    adminOrigin = await listen(admin)
    apiOrigin = await listen(api)
  })

  afterAll(async () => {
    await new Promise<void>(resolve => admin.close(() => resolve()))
    await new Promise<void>(resolve => api.close(() => resolve()))
    await new Promise<void>(resolve => fakeDoorman.close(() => resolve()))
    hub.stop()
    hub.close()
    fs.rmSync(root, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('serves the page at each tab’s own address', async () => {
    for (const tab of ['/', '/data', '/people']) {
      const response = await fetch(`${adminOrigin}${tab}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('<script type="module" src="/admin.js">')
    }
    for (const name of ['index.html', 'admin.css', 'admin.js']) {
      expect(fs.existsSync(path.join(ADMIN_DIR, name))).toBe(true)
    }
  })

  it('wears the app’s own colours, light and dark', () => {
    const css = fs.readFileSync(path.join(ADMIN_DIR, 'admin.css'), 'utf8')
    const dark = css.indexOf('@media (prefers-color-scheme: dark)')
    const blocks = { light: css.slice(0, dark), dark: css.slice(dark) }
    const names = {
      surface0: 'surface0',
      surface1: 'surface1',
      surface2: 'surface2',
      surface3: 'surface3',
      'text-primary': 'textPrimary',
      'text-secondary': 'textSecondary',
      'text-muted': 'textMuted',
      accent: 'accent',
      'accent-dim': 'accentDim',
      'accent-selected': 'accentSelected',
      'on-accent': 'onAccent',
      'on-primary': 'onPrimary',
      good: 'good',
      warning: 'warning',
      danger: 'danger',
      border: 'border',
      'card-shadow': 'cardShadow',
    } as const
    for (const [scheme, palette] of [
      ['light', lightPalette()],
      ['dark', darkPalette()],
    ] as const) {
      for (const [css, token] of Object.entries(names)) {
        const value = new RegExp(`--${css}: (#[0-9a-f]+);`).exec(blocks[scheme])?.[1]
        expect({ scheme, css, value }).toEqual({ scheme, css, value: palette[token] })
      }
    }
  })

  it('answers only to its own names', async () => {
    const asked = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const url = new URL(adminOrigin)
        http
          .get({ hostname: url.hostname, port: url.port, path: '/', headers: { host } }, res => {
            res.resume()
            resolve(res.statusCode ?? 0)
          })
          .on('error', reject)
      })
    expect(await asked('pi.example.ts.net:4443')).toBe(200)
    expect(await asked('localhost:4610')).toBe(200)
    expect(await asked('evil.example.com')).toBe(421)
  })

  it('asks nothing of anywhere but itself', async () => {
    const response = await fetch(`${adminOrigin}/data`)
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("connect-src 'self';")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('shows and changes who can sign in, through the doorman with its admin key', async () => {
    const read = await fetch(`${adminOrigin}/api/admin/people`)
    expect(read.status).toBe(200)
    expect(DoormanAccessSchema.parse(await read.json()).emails).toEqual(['friend@example.com'])

    const put = await fetch(`${adminOrigin}/api/admin/people`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anyone: false, emails: ['friend@example.com', 'new@example.com'] }),
    })
    expect(put.status).toBe(200)
    expect(DoormanAccessSchema.parse(await put.json()).emails).toContain('new@example.com')
    expect(doormanSeen.at(-1)).toEqual({ method: 'PUT', path: '/v1/access', auth: `Bearer ${KEY}` })

    // A form posted from a page elsewhere is not JSON, so it changes nothing.
    const form = await fetch(`${adminOrigin}/api/admin/people`, {
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'anyone=true',
    })
    expect(form.status).toBe(400)
    expect(list.anyone).toBe(false)
  })

  it('says plainly when the doorman will not take the key', async () => {
    process.env['SELFMP3_DOORMAN_ADMIN_TOKEN'] = 'w'.repeat(64)
    const wrongHub = new Hub(loadConfig(), createLogger('silent'), null)
    const wrong = http.createServer(createAdminApp(wrongHub))
    const origin = await listen(wrong)
    try {
      const response = await fetch(`${origin}/api/admin/people`)
      expect(response.status).toBe(424)
      expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/admin key/)
      const data = AdminDataSchema.parse(await (await fetch(`${origin}/api/admin/data`)).json())
      expect(data.doorman).toBeNull()
      expect(data.doormanProblem).toMatch(/admin key/)
    } finally {
      process.env['SELFMP3_DOORMAN_ADMIN_TOKEN'] = KEY
      await new Promise<void>(resolve => wrong.close(() => resolve()))
      wrongHub.close()
    }
  })

  it('adds what a device reports to the day’s totals, and keeps nothing else', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const report = await fetch(`${apiOrigin}/api/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ day, uses: { search: 3, lyrics: 1 }, errors: { 'server-away': 2 } }),
    })
    expect(report.status).toBe(200)

    const response = await fetch(`${adminOrigin}/api/admin/data?days=7`)
    expect(response.status).toBe(200)
    const data = AdminDataSchema.parse(await response.json())
    expect(data.usage).toEqual([
      { feature: 'search', count: 3 },
      { feature: 'lyrics', count: 1 },
    ])
    expect(data.errors).toEqual([{ from: 'app', name: 'server-away', count: 2, lastDay: day }])
    expect(data.imports.byDay).toHaveLength(7)
    expect(data.imports.medianByDay).toHaveLength(7)
    expect(data.plays).toHaveLength(7)
    expect(data.doorman?.days[0]?.counts['reads.audio']).toBe(5)
    expect(data.status.smart).toBe('off')
  })

  it('leaves the public port with the API alone: no page at all', async () => {
    for (const asked of ['/', '/admin.js', '/data']) {
      const response = await fetch(`${apiOrigin}${asked}`)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
    }
    expect((await fetch(`${apiOrigin}/api/health`)).status).toBe(200)
    // The admin data is not on the public port either.
    expect((await fetch(`${apiOrigin}/api/admin/data`)).status).toBe(404)
  })
})
