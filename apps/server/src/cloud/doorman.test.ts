import { describe, expect, it } from 'vitest'
import type { DoormanMe } from '@selfmp3/shared'
import { DoormanClient } from './doorman.js'
import { CloudError } from './store.js'

/**
 * The Mac's side of the doorman, against a stand-in that records what it was
 * asked and answers the way the Worker does. What matters: the session goes
 * with every request, keys arrive intact, and each way of failing becomes an
 * error that says what to do about it.
 */

const ME: DoormanMe = {
  email: 'me@example.com',
  name: 'Me',
  picture: null,
  storage: {
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
    region: 'us-west-004',
    bucket: 'my-music',
    prefix: 'selfmp3',
    keyIdHint: '004abc…',
  },
}

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

function stand(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const client = new DoormanClient('https://doorman.test/', async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const raw = init?.body
    const body =
      typeof raw === 'string' ? raw : raw instanceof Uint8Array ? Buffer.from(raw).toString() : null
    const call = { method: init?.method ?? 'GET', url, headers, body }
    calls.push(call)
    return answer(call)
  })
  return { client, calls }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

describe('DoormanClient', () => {
  it('builds the sign-in address with the attempt, and a way back', () => {
    const { client } = stand(() => json({}))
    expect(client.signInUrl('a'.repeat(32), 'http://localhost:4601/settings')).toBe(
      `https://doorman.test/v1/auth/start?attempt=${'a'.repeat(32)}&return=http%3A%2F%2Flocalhost%3A4601%2Fsettings`,
    )
  })

  it('claims a sign-in: pending, then signed in with the account', async () => {
    let answered = false
    const { client, calls } = stand(() => {
      if (!answered) {
        answered = true
        return json({ status: 'pending' })
      }
      return json({ status: 'signed-in', token: 't'.repeat(43), me: ME })
    })
    expect(await client.claim('b'.repeat(32))).toEqual({ status: 'pending' })
    const second = await client.claim('b'.repeat(32))
    expect(second.status === 'signed-in' && second.me.email).toBe('me@example.com')
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://doorman.test/v1/auth/claim',
      body: JSON.stringify({ attempt: 'b'.repeat(32) }),
    })
  })

  it('sends the session with every signed-in request', async () => {
    const { client, calls } = stand(() => json(ME))
    await client.me('session-token')
    expect(calls[0]?.headers['authorization']).toBe('Bearer session-token')
  })

  it('turns each way of failing into an error that says what to do', async () => {
    const answers: Array<[Response, string, RegExp]> = [
      [json({ error: 'nope', code: 'unauthorized' }, 401), 'auth', /Sign in again/],
      [json({ error: 'no bucket', code: 'conflict' }, 409), 'missing', /No bucket/],
      [json({ error: 'The bucket refused the key.', code: 'x' }, 422), 'other', /refused the key/],
    ]
    for (const [response, kind, text] of answers) {
      const { client } = stand(() => response)
      const error = await client.me('t').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(CloudError)
      expect(error).toMatchObject({ kind })
      expect((error as Error).message).toMatch(text)
    }
    const offline = new DoormanClient('https://doorman.test', () =>
      Promise.reject(new TypeError('fetch failed')),
    )
    await expect(offline.me('t')).rejects.toMatchObject({ kind: 'network' })
  })

  describe('the bucket, through it', () => {
    it('encodes each part of a key and keeps the slashes', async () => {
      const { client, calls } = stand(() => new Response(null, { status: 404 }))
      const store = client.store('t', 'test')
      expect(await store.head('snapshots/20260911T142205123Z-mac-3f9a1c2e.json')).toBeNull()
      expect(calls[0]?.url).toBe(
        'https://doorman.test/v1/files/snapshots/20260911T142205123Z-mac-3f9a1c2e.json',
      )
      expect(calls[0]?.method).toBe('HEAD')
    })

    it('reads a file, and says null for one that is not there', async () => {
      const { client } = stand(call =>
        call.url.endsWith('format.json')
          ? new Response('{"format":1}', { status: 200 })
          : new Response(null, { status: 404 }),
      )
      const store = client.store('t', 'test')
      expect((await store.get('format.json'))?.toString()).toBe('{"format":1}')
      expect(await store.get('audio/missing.m4a')).toBeNull()
    })

    it('writes a file with its type, encoding and length', async () => {
      const { client, calls } = stand(() => new Response(null, { status: 204 }))
      await client.store('t', 'test').put('snapshots/x.json', Buffer.from('gzipped'), {
        contentType: 'application/json',
        contentEncoding: 'gzip',
      })
      expect(calls[0]).toMatchObject({
        method: 'PUT',
        body: 'gzipped',
        headers: {
          authorization: 'Bearer t',
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '7',
        },
      })
    })

    it('follows a listing across pages', async () => {
      const { client, calls } = stand(call =>
        call.url.includes('cursor=')
          ? json({ objects: [{ key: 'audio/b.m4a', size: 2 }], cursor: null })
          : json({ objects: [{ key: 'audio/a.m4a', size: 1 }], cursor: 'next' }),
      )
      expect(await client.store('t', 'test').list('audio/')).toEqual([
        { key: 'audio/a.m4a', size: 1 },
        { key: 'audio/b.m4a', size: 2 },
      ])
      expect(calls[1]?.url).toBe('https://doorman.test/v1/list?prefix=audio%2F&cursor=next')
    })

    it('does not mind deleting what is already gone', async () => {
      const { client } = stand(() => new Response(null, { status: 404 }))
      await expect(client.store('t', 'test').delete('snapshots/old.json')).resolves.toBeUndefined()
    })
  })
})
