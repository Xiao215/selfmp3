import {
  DoormanGrantMadeSchema,
  DoormanGrantsSchema,
  DoormanMeSchema,
  ErrorBodySchema,
} from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { harness, type Harness } from './fakes.js'

/**
 * Grants: a server given its own way into an account's bucket, that outlives
 * the device that asked for it and can be taken back
 * (docs/features/shared-server.md).
 */

const PI = { server: 'https://pi.example.ts.net', name: 'pi' }

async function grant(h: Harness, token: string, request = PI) {
  const response = await h.call('/v1/grants', { method: 'POST', token, json: request })
  expect(response.status).toBe(201)
  return DoormanGrantMadeSchema.parse(await response.json())
}

async function listed(h: Harness, token: string) {
  const response = await h.call('/v1/grants', { token })
  expect(response.status).toBe(200)
  return DoormanGrantsSchema.parse(await response.json()).grants
}

describe('grants', () => {
  it('gives a server a session of its own, for the same account, that lasts past 180 days', async () => {
    const h = harness()
    const phone = await h.signIn()
    const made = await grant(h, phone)

    const asServer = await h.call('/v1/me', { token: made.token })
    expect(asServer.status).toBe(200)
    const asPhone = await h.call('/v1/me', { token: phone })
    expect(DoormanMeSchema.parse(await asServer.json()).account).toBe(
      DoormanMeSchema.parse(await asPhone.json()).account,
    )

    h.clock.now += 200 * 24 * 60 * 60_000
    expect((await h.call('/v1/me', { token: made.token })).status).toBe(200)
    expect((await h.call('/v1/me', { token: phone })).status).toBe(401)
  })

  it('lists each server once: asking again replaces the grant it had', async () => {
    const h = harness()
    const phone = await h.signIn()
    const first = await grant(h, phone)
    const second = await grant(h, phone)
    await grant(h, phone, { server: 'https://other.example.com', name: 'other' })

    const grants = await listed(h, phone)
    expect(grants.map(g => g.server)).toEqual([PI.server, 'https://other.example.com'])
    expect(grants[0]?.id).toBe(second.grant.id)
    expect(JSON.stringify(grants)).not.toContain(second.token)
    expect((await h.call('/v1/me', { token: first.token })).status).toBe(401)
    expect((await h.call('/v1/me', { token: second.token })).status).toBe(200)
  })

  it('ends when taken back, from a device or by the server itself', async () => {
    const h = harness()
    const phone = await h.signIn()
    const made = await grant(h, phone)
    const other = await grant(h, phone, { server: 'https://other.example.com', name: 'other' })

    const removed = await h.call(`/v1/grants/${made.grant.id}`, { method: 'DELETE', token: phone })
    expect(removed.status).toBe(204)
    expect((await h.call('/v1/me', { token: made.token })).status).toBe(401)
    expect((await listed(h, phone)).map(g => g.id)).toEqual([other.grant.id])

    const left = await h.call(`/v1/grants/${other.grant.id}`, {
      method: 'DELETE',
      token: other.token,
    })
    expect(left.status).toBe(204)
    expect(await listed(h, phone)).toEqual([])
    const again = await h.call(`/v1/grants/${other.grant.id}`, { method: 'DELETE', token: phone })
    expect(again.status).toBe(404)
  })

  it('cannot be passed on: a grant makes no grants', async () => {
    const h = harness()
    const made = await grant(h, await h.signIn())
    const response = await h.call('/v1/grants', {
      method: 'POST',
      token: made.token,
      json: { server: 'https://elsewhere.example.com', name: 'elsewhere' },
    })
    expect(response.status).toBe(403)
    expect(ErrorBodySchema.parse(await response.json()).error).toMatch(/pass its grant on/)
  })

  it('is one account’s alone, and ends with signing out everywhere', async () => {
    const h = harness()
    const phone = await h.signIn()
    const friend = await h.signIn({ sub: '2', email: 'friend@example.com' })
    const made = await grant(h, phone)

    expect(await listed(h, friend)).toEqual([])
    const theirs = await h.call(`/v1/grants/${made.grant.id}`, { method: 'DELETE', token: friend })
    expect(theirs.status).toBe(404)

    h.clock.now += 1000
    const out = await h.call('/v1/auth/signout-everywhere', { method: 'POST', token: phone })
    expect(out.status).toBe(204)
    expect((await h.call('/v1/me', { token: made.token })).status).toBe(401)
    h.clock.now += 1000
    const fresh = await h.signIn()
    expect(await listed(h, fresh)).toEqual([])
  })

  it('needs a session, and a server address that is one', async () => {
    const h = harness()
    expect((await h.call('/v1/grants', { method: 'POST', json: PI })).status).toBe(401)
    const phone = await h.signIn()
    const bad = await h.call('/v1/grants', {
      method: 'POST',
      token: phone,
      json: { server: 'not an address', name: 'x' },
    })
    expect(bad.status).toBe(400)
    expect((await h.call('/v1/grants/nope', { method: 'DELETE', token: phone })).status).toBe(404)
  })

  describe('telling the server', () => {
    /** What the server at PI's address was sent, with the doorman's background work done. */
    function listening(h: Harness, answer?: () => Promise<Response>) {
      const heard: Array<{ method: string; path: string; auth: string | null; body: unknown }> = []
      h.elsewhere.set('pi.example.ts.net', async request => {
        heard.push({
          method: request.method,
          path: new URL(request.url).pathname,
          auth: request.headers.get('authorization'),
          body: await request.json(),
        })
        return answer ? answer() : new Response(null, { status: 204 })
      })
      return heard
    }

    it('tells the server when its grant is taken back, with nothing secret', async () => {
      const h = harness()
      const heard = listening(h)
      const phone = await h.signIn()
      const made = await grant(h, phone)
      await h.settle()
      expect(heard).toEqual([])

      const removed = await h.call(`/v1/grants/${made.grant.id}`, {
        method: 'DELETE',
        token: phone,
      })
      expect(removed.status).toBe(204)
      await h.settle()
      expect(heard).toEqual([
        { method: 'POST', path: '/api/hub/check', auth: null, body: { grant: made.grant.id } },
      ])
      const sent = h.outside.find(request => request.url.host === 'pi.example.ts.net')
      expect(sent?.init.redirect).toBe('manual')
      expect(JSON.stringify(sent?.init.body)).not.toContain(made.token)
    })

    it('answers Remove without waiting on the server', async () => {
      const h = harness()
      // A server that never answers: Remove is answered all the same.
      const heard = listening(h, () => new Promise(() => undefined))
      const phone = await h.signIn()
      const made = await grant(h, phone)
      const removed = await h.call(`/v1/grants/${made.grant.id}`, {
        method: 'DELETE',
        token: phone,
      })
      expect(removed.status).toBe(204)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(heard).toHaveLength(1)
    })

    it('minds nothing when the server is off: it finds out at its next look', async () => {
      const h = harness()
      const phone = await h.signIn()
      const off = await grant(h, phone, { server: 'https://off.example.com', name: 'off' })
      const gone = await h.call(`/v1/grants/${off.grant.id}`, { method: 'DELETE', token: phone })
      expect(gone.status).toBe(204)
      await h.settle()
      expect(h.logs).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          details: expect.objectContaining({ server: 'off.example.com' }),
        }),
      )
      expect((await h.call('/v1/me', { token: off.token })).status).toBe(401)
    })

    it('tells every server when the account signs out everywhere', async () => {
      const h = harness()
      const heard = listening(h)
      const phone = await h.signIn()
      const made = await grant(h, phone)
      h.clock.now += 1000
      expect(
        (await h.call('/v1/auth/signout-everywhere', { method: 'POST', token: phone })).status,
      ).toBe(204)
      await h.settle()
      expect(heard.map(seen => seen.body)).toEqual([{ grant: made.grant.id }])
    })

    it('does not tell a server that let the account go itself, or one at no web address', async () => {
      const h = harness()
      const heard = listening(h)
      const phone = await h.signIn()
      const made = await grant(h, phone)
      const left = await h.call(`/v1/grants/${made.grant.id}`, {
        method: 'DELETE',
        token: made.token,
      })
      expect(left.status).toBe(204)

      const odd = await grant(h, phone, { server: 'ftp://pi.example.ts.net', name: 'odd' })
      await h.call(`/v1/grants/${odd.grant.id}`, { method: 'DELETE', token: phone })
      await h.settle()
      expect(heard).toEqual([])
    })
  })
})
