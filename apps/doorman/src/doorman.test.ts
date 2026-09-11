import { DoormanHealthSchema, ErrorBodySchema } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import {
  APP_ORIGIN,
  APPLICATION_KEY,
  CLIENT_SECRET,
  KEY_ID,
  SEAL_KEY,
  harness,
  newAttempt,
} from './fakes.js'

/**
 * The doorman as a whole: routing, CORS for the web app, the shape of every
 * error, and — across a whole session of use — that nothing secret ever
 * comes back out.
 */

const EVIL = 'https://evil.example'

describe('routing', () => {
  it('says it is up, without a session', async () => {
    const h = harness()
    const response = await h.call('/v1/health')
    expect(response.status).toBe(200)
    expect(DoormanHealthSchema.parse(await response.json())).toEqual({ ok: true, version: '1.0.0' })
  })

  it('answers what it does not know with a JSON 404', async () => {
    const h = harness()
    for (const path of ['/', '/v2/health', '/v1', '/v1/nothing', '/favicon.ico']) {
      const response = await h.call(path)
      expect(response.status, path).toBe(404)
      expect(ErrorBodySchema.parse(await response.json()).code).toBe('not_found')
    }
  })

  it('says which methods a route takes', async () => {
    const h = harness()
    const response = await h.call('/v1/storage', { method: 'POST', json: {} })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('PUT, DELETE')
    expect(ErrorBodySchema.parse(await response.json())).toEqual({
      error: 'use PUT or DELETE',
      code: 'method_not_allowed',
    })
    const files = await h.call(`/v1/files/format.json`, { method: 'POST', json: {} })
    expect(files.status).toBe(405)
    expect(files.headers.get('allow')).toBe('GET, HEAD, PUT, DELETE')
  })

  it('does not mistake a method for something every object has', async () => {
    const h = harness()
    for (const method of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const response = await h.call('/v1/health', { method })
      expect(response.status, method).toBe(405)
      expect(ErrorBodySchema.parse(await response.json()).code).toBe('method_not_allowed')
    }
  })
})

describe('CORS', () => {
  const preflight = (origin: string | null, method = 'PUT') => {
    const h = harness()
    return h.call('/v1/files/format.json', {
      method: 'OPTIONS',
      headers: {
        ...(origin ? { origin } : {}),
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization, content-type',
      },
    })
  }

  it('lets the web app in', async () => {
    for (const origin of [APP_ORIGIN, 'http://localhost:4600']) {
      const response = await preflight(origin)
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET, HEAD, PUT, POST, DELETE, OPTIONS',
      )
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Authorization, Content-Type, Content-Encoding, Range, If-None-Match',
      )
      expect(response.headers.get('access-control-max-age')).toBe('86400')
      expect(response.headers.get('vary')).toBe('Origin')
    }
  })

  it('turns every other page away', async () => {
    for (const origin of [EVIL, 'https://xiao215.github.io.evil.example', 'null']) {
      const response = await preflight(origin)
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(response.headers.get('vary')).toBe('Origin')
    }
  })

  it('answers an OPTIONS that is not from a browser plainly', async () => {
    const response = await preflight(null)
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('allow')).toMatch(/PUT/)
  })

  it('names the web app on every answer, and lets it read the headers it needs', async () => {
    const h = harness()
    const token = await h.signIn()
    for (const path of ['/v1/health', '/v1/me', '/v1/list']) {
      const response = await h.call(path, { token, origin: APP_ORIGIN })
      expect(response.headers.get('access-control-allow-origin'), path).toBe(APP_ORIGIN)
      expect(response.headers.get('access-control-expose-headers')).toBe(
        'Content-Length, Content-Range, Content-Encoding, ETag, Accept-Ranges',
      )
      expect(response.headers.get('vary')).toMatch(/Origin/)
    }
  })

  it('gives another page nothing to read, and nothing to change', async () => {
    const h = harness()
    const token = await h.signIn()
    const read = await h.call('/v1/me', { token, origin: EVIL })
    expect(read.headers.get('access-control-allow-origin')).toBeNull()
    expect(read.headers.get('vary')).toBe('Origin')

    const write = await h.call('/v1/auth/claim', { origin: EVIL, json: { attempt: newAttempt() } })
    expect(write.status).toBe(403)
    const signOut = await h.call('/v1/auth/signout', { method: 'POST', token, origin: EVIL })
    expect(signOut.status).toBe(403)
    expect((await h.call('/v1/me', { token })).status).toBe(200)
  })

  it('serves the Mac’s server, which sends no Origin, as it is', async () => {
    const h = harness()
    const token = await h.signIn()
    const response = await h.call('/v1/me', { token })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('what comes back out', () => {
  it('never includes a secret, a key, or someone’s session', async () => {
    const h = harness()
    const texts: string[] = []
    const keep = async (response: Response): Promise<Response> => {
      texts.push(await response.clone().text(), JSON.stringify([...response.headers]))
      return response
    }

    const token = await h.signIn()
    const other = await h.signIn({ sub: '2', email: 'friend@example.com' })
    await keep(await h.connect(token))
    await keep(await h.connect(token, { keyId: `${KEY_ID}x` }))
    await keep(await h.connect(token, { applicationKey: `${APPLICATION_KEY}x` }))
    await keep(await h.connect(token, { bucket: 'nope-bucket' }))
    await keep(await h.call('/v1/me', { token }))
    await keep(await h.call('/v1/list', { token }))
    await keep(await h.call('/v1/files/format.json', { token }))
    await keep(await h.call('/v1/storage', { method: 'POST', token }))
    await keep(await h.call('/v1/me', { token: 'C'.repeat(43) }))
    h.bucket.revoked = true
    await keep(await h.call('/v1/list', { token }))

    const everything = texts.join('\n')
    for (const secret of [APPLICATION_KEY, KEY_ID, CLIENT_SECRET, SEAL_KEY, token, other]) {
      expect(everything).not.toContain(secret)
    }
  })
})
