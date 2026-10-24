import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { darkPalette, lightPalette } from '@selfmp3/client/tokens'
import { AdminDataSchema, AdminServerSchema, AdminSignInSchema } from '@selfmp3/shared'
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
  ] as const
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
    hub.stop()
    hub.close()
    fs.rmSync(root, { recursive: true, force: true })
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('serves the page at each tab’s own address', async () => {
    for (const tab of ['/', '/data', '/access', '/server']) {
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

  it('lets the page talk to the doorman and nowhere else', async () => {
    const response = await fetch(`${adminOrigin}/data`)
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/connect-src 'self' https:\/\/selfmp3-doorman/)
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('says how the server is', async () => {
    const response = await fetch(`${adminOrigin}/api/admin/server`)
    expect(response.status).toBe(200)
    const server = AdminServerSchema.parse(await response.json())
    expect(server.libraries).toBe(1)
    expect(server.smart).toBe('off')
    expect(server.memory.totalBytes).toBeGreaterThan(0)
    expect(server.doorman?.paths.access).toBe('/v1/access')
  })

  it('sends a sign-in back to the tab it came from, at the page’s own address', async () => {
    const attempt = 'a'.repeat(32)
    const response = await fetch(`${adminOrigin}/api/admin/signin?attempt=${attempt}&tab=access`)
    const { url } = AdminSignInSchema.parse(await response.json())
    const start = new URL(url)
    expect(start.pathname).toBe('/v1/auth/start')
    expect(start.searchParams.get('attempt')).toBe(attempt)
    expect(start.searchParams.get('return')).toBe('https://pi.example.ts.net:4443/access')
    expect((await fetch(`${adminOrigin}/api/admin/signin?attempt=nope&tab=access`)).status).toBe(
      400,
    )
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
    expect(data.plays).toHaveLength(7)
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
