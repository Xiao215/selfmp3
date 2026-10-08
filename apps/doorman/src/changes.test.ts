import { CHANGES_HEADER, DoormanChangesSchema, parseChangesHeader } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { utf8 } from './encoding.js'
import { harness, ME, type Harness } from './fakes.js'

/**
 * The account's change counter: what a device asks before listing the bucket,
 * so that a look which would find nothing new costs the bucket nothing.
 */

const SHA = 'cd'.repeat(32)
const LOG = 'log/iphone-0b7d44a1/000000000001.json'
const SNAPSHOT = 'snapshots/20260911T120000000Z-mac-3f9a1c2e.json'

async function connected(): Promise<{ h: Harness; token: string }> {
  const h = harness()
  const token = await h.signIn()
  expect((await h.connect(token)).status).toBe(200)
  h.bucket.requests.length = 0
  return { h, token }
}

async function counter(h: Harness, token: string): Promise<string> {
  const response = await h.call('/v1/changes', { token })
  expect(response.status).toBe(200)
  return DoormanChangesSchema.parse(await response.json()).changes
}

function put(h: Harness, token: string, key: string, text = '{}'): Promise<Response> {
  return h.call(`/v1/files/${key}`, {
    method: 'PUT',
    token,
    body: text,
    headers: { 'content-type': 'application/json', 'content-length': String(utf8(text).length) },
  })
}

describe('the change counter', () => {
  it('stands still while nothing is written, and asks nothing of the bucket', async () => {
    const { h, token } = await connected()
    const first = await counter(h, token)
    expect(await counter(h, token)).toBe(first)
    expect(h.bucket.requests).toEqual([])
  })

  it('moves once for each snapshot or log file written or deleted, and says from where to where', async () => {
    const { h, token } = await connected()
    let held = await counter(h, token)

    for (const [key, method] of [
      [LOG, 'PUT'],
      [SNAPSHOT, 'PUT'],
      [LOG, 'DELETE'],
    ] as const) {
      const response =
        method === 'PUT'
          ? await put(h, token, key)
          : await h.call(`/v1/files/${key}`, { method, token })
      expect(response.status).toBe(204)
      const moved = parseChangesHeader(response.headers.get(CHANGES_HEADER))
      expect(moved?.before, key).toBe(held)
      expect(moved?.after).not.toBe(held)
      expect(await counter(h, token)).toBe(moved?.after)
      held = moved?.after ?? ''
    }
  })

  it('does not move for the files a look never lists', async () => {
    const { h, token } = await connected()
    const before = await counter(h, token)
    for (const key of [`audio/${SHA}.m4a`, `covers/${SHA}.jpg`, `lyrics/${SHA}.lrc`]) {
      const response = await put(h, token, key, 'bytes')
      expect(response.status).toBe(204)
      expect(response.headers.get(CHANGES_HEADER)).toBeNull()
    }
    expect(await counter(h, token)).toBe(before)
  })

  it('is each account’s own', async () => {
    const { h, token } = await connected()
    const friend = await h.signIn({ sub: '208234567890123456789', email: 'friend@example.com' })
    expect((await h.connect(friend, { prefix: 'friend' })).status).toBe(200)
    const theirs = await counter(h, friend)

    expect((await put(h, token, LOG)).status).toBe(204)
    expect(await counter(h, friend)).toBe(theirs)
    expect(h.changes.objects.has(ME.sub)).toBe(true)
  })

  it('lets a write stand when the counter cannot be reached, and leaves the header off', async () => {
    const { h, token } = await connected()
    h.changes.failing = true
    const response = await put(h, token, LOG)
    expect(response.status).toBe(204)
    expect(response.headers.get(CHANGES_HEADER)).toBeNull()
    expect(h.bucket.text(`selfmp3/${LOG}`)).toBe('{}')
    expect(h.logs.map(entry => entry.message)).toContain('the change counter could not be moved')
  })

  it('is a 404 on a doorman deployed without one, which a device reads as “list, then”', async () => {
    const { h, token } = await connected()
    delete h.env.CHANGES
    expect((await h.call('/v1/changes', { token })).status).toBe(404)
    const response = await put(h, token, LOG)
    expect(response.status).toBe(204)
    expect(response.headers.get(CHANGES_HEADER)).toBeNull()
  })

  it('needs a session', async () => {
    const { h } = await connected()
    expect((await h.call('/v1/changes')).status).toBe(401)
  })

  it('shows its header to the web app', async () => {
    const { h, token } = await connected()
    const response = await h.call(`/v1/files/${LOG}`, {
      method: 'PUT',
      token,
      origin: 'https://xiao215.github.io',
      body: '{}',
      headers: { 'content-type': 'application/json', 'content-length': '2' },
    })
    expect(response.headers.get('access-control-expose-headers')).toMatch(/Selfmp3-Changes/)
  })
})
