import { describe, expect, it } from 'vitest'
import type { CloudPlatform, CloudResponse, DeviceStore } from './platform.js'
import type { CloudSession, CloudSessionApi } from './session.js'
import { createSharedServer } from './sharedServer.js'

/**
 * Joining the server that works for anyone signed in, from a device
 * (docs/features/shared-server.md): what is sent, what is kept, and for whom.
 */

const SERVER = 'https://pi.example.ts.net'
const ME: CloudSession = {
  doormanUrl: 'https://doorman.test',
  token: 'session-token',
  me: { email: 'me@example.com', name: null, picture: null, storage: null },
}
const ANSWER = {
  id: 'the-shared-server',
  addresses: [SERVER],
  token: 'library-token'.padEnd(43, '0'),
}
/** The same account once its bucket is connected. */
const WITH_BUCKET: CloudSession = {
  ...ME,
  me: {
    ...ME.me,
    storage: {
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      region: 'us-west-004',
      bucket: 'theirs',
      prefix: 'selfmp3',
      keyIdHint: '004abc…',
    },
  },
}

function memoryStore(): DeviceStore {
  const values = new Map<string, unknown>()
  return {
    read: key => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    remove: key => {
      values.delete(key)
      return Promise.resolve()
    },
    update: (key, change) => {
      const next = change(values.get(key) ?? null)
      values.set(key, next)
      return Promise.resolve(next)
    },
  }
}

function json(body: unknown, status = 200): CloudResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

const GRANT = {
  id: '0123456789abcdef',
  server: SERVER,
  name: 'pi',
  createdAt: '2026-10-12T00:00:00.000Z',
}

function setUp(
  answer: (url: string, method: string) => CloudResponse = () => json(ANSWER),
  given: (typeof GRANT)[] = [GRANT],
) {
  const sent: { url: string; method: string; auth: string | undefined }[] = []
  const platform = {
    doormanUrl: ME.doormanUrl,
    sharedServerUrl: `${SERVER}/`,
    store: memoryStore(),
    fetch: (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const method = init?.method ?? 'GET'
      sent.push({ url, method, auth: init?.headers?.['Authorization'] })
      return Promise.resolve(answer(url, method))
    },
  } as unknown as CloudPlatform
  const doorman: string[] = []
  const sessionApi = {
    doormanFetch: (_session: CloudSession | null, path: string, options?: { method?: string }) => {
      doorman.push(`${options?.method ?? 'GET'} ${path}`)
      return Promise.resolve(json({ grants: given }))
    },
  } as unknown as CloudSessionApi
  return { shared: createSharedServer(platform, sessionApi), sent, doorman }
}

describe('the shared server, from a device', () => {
  it('joins with the doorman session, and keeps the answer for this account only', async () => {
    const { shared, sent } = setUp()
    expect(await shared.joined(ME)).toBeNull()

    expect(await shared.join(ME)).toEqual(ANSWER)
    expect(sent).toEqual([
      { url: `${SERVER}/api/hub/join`, method: 'POST', auth: 'Bearer session-token' },
    ])
    expect(await shared.joined(ME)).toEqual(ANSWER)
    const someoneElse = { ...ME, me: { ...ME.me, email: 'friend@example.com' } }
    expect(await shared.joined(someoneElse)).toBeNull()
  })

  it('says what the server said when it refuses', async () => {
    const { shared } = setUp(() => json({ error: 'Connect your storage first.' }, 409))
    await expect(shared.join(ME)).rejects.toMatchObject({
      status: 409,
      message: 'Connect your storage first.',
    })
    expect(await shared.joined(ME)).toBeNull()
  })

  it('lists and removes grants through the doorman', async () => {
    const { shared, doorman } = setUp()
    expect((await shared.grants(ME)).grants.map(grant => grant.server)).toEqual([SERVER])
    await shared.removeGrant(ME, '0123456789abcdef', null)
    expect(doorman).toEqual([
      'GET /v1/grants',
      'GET /v1/grants',
      'DELETE /v1/grants/0123456789abcdef',
    ])
  })

  it('joins by itself, once, when the bucket names no server', async () => {
    const { shared, sent } = setUp()
    const [first, second] = await Promise.all([
      shared.automatic(WITH_BUCKET, null),
      shared.automatic(WITH_BUCKET, null),
    ])
    expect(first).toEqual(ANSWER)
    expect(second).toEqual(ANSWER)
    expect(await shared.automatic(WITH_BUCKET, null)).toEqual(ANSWER)
    expect(sent).toHaveLength(1)
  })

  it('leaves alone a library whose snapshot names a server, or that has no bucket yet', async () => {
    const { shared, sent } = setUp()
    const own = { id: 'my-own-server', addresses: ['https://mine.example.com'], token: 'own' }
    expect(await shared.automatic(WITH_BUCKET, own)).toEqual(own)
    expect(await shared.automatic(ME, null)).toBeNull()
    expect(sent).toEqual([])
  })

  it('waits a while after a join that failed, rather than asking on every look', async () => {
    const { shared, sent } = setUp(() => json({ error: 'busy' }, 502))
    expect(await shared.automatic(WITH_BUCKET, null)).toBeNull()
    expect(await shared.automatic(WITH_BUCKET, null)).toBeNull()
    expect(sent).toHaveLength(1)
  })

  it('does not join again by itself once the shared server was removed here, until joined by hand', async () => {
    const { shared, sent } = setUp()
    await shared.automatic(WITH_BUCKET, null)
    await shared.removeGrant(WITH_BUCKET, '0123456789abcdef', null)
    expect(await shared.automatic(WITH_BUCKET, null)).toBeNull()
    expect(sent).toHaveLength(1)

    await shared.join(WITH_BUCKET)
    expect(await shared.automatic(WITH_BUCKET, null)).toEqual(ANSWER)
  })

  /*
   * 2026-10-14: Settings › Account › Computers › Remove took the shared
   * server's grant back, the server let the library go — and the bucket's
   * newest snapshot went on naming it, since it could no longer write one that
   * did not. Every device kept choosing it, and every import was refused.
   */
  describe('a server the snapshot names that no longer works for the library', () => {
    /** What the snapshot still names: the shared server, with the token it let go of. */
    const STALE = { ...ANSWER, token: 'let-go'.padEnd(43, '0') }

    it('is passed over at once on the device that removed it, and not joined again', async () => {
      const { shared, sent } = setUp()
      expect(await shared.automatic(WITH_BUCKET, STALE)).toEqual(STALE)
      await shared.removeGrant(WITH_BUCKET, GRANT.id, STALE)
      expect(await shared.automatic(WITH_BUCKET, STALE)).toBeNull()
      expect(sent).toEqual([])
    })

    it('counts as left when the account took it back on another device', async () => {
      // No grant for it any more: Remove was pressed somewhere else.
      const { shared, sent, doorman } = setUp(() => json(ANSWER), [])
      expect(await shared.refused(WITH_BUCKET, STALE.token, STALE)).toBeNull()
      expect(doorman).toEqual(['GET /v1/grants'])
      expect(await shared.automatic(WITH_BUCKET, STALE)).toBeNull()
      expect(sent).toEqual([])

      // Joining by hand is still there: the new library, until the snapshot names it.
      expect(await shared.join(WITH_BUCKET)).toEqual(ANSWER)
      expect(await shared.automatic(WITH_BUCKET, STALE)).toEqual(ANSWER)
    })

    it('is joined again when its grant is still there: nobody asked it to stop', async () => {
      // Its hub.json lost, say: a new workspace, behind a new token.
      const { shared, sent } = setUp()
      expect(await shared.refused(WITH_BUCKET, STALE.token, STALE)).toEqual(ANSWER)
      expect(sent).toHaveLength(1)
      // The snapshot still names the old token until the server's next one lands.
      expect(await shared.automatic(WITH_BUCKET, STALE)).toEqual(ANSWER)
      expect(await shared.automatic(WITH_BUCKET, ANSWER)).toEqual(ANSWER)
      expect(sent).toHaveLength(1)
    })

    it('gives way to the shared server when it is another one', async () => {
      const own = { id: 'my-own-server', addresses: ['https://mine.example.com'], token: 'own' }
      const { shared, doorman } = setUp()
      expect(await shared.refused(WITH_BUCKET, 'own', own)).toEqual(ANSWER)
      // Not the shared one: whose grants it had is not this device's to ask.
      expect(doorman).toEqual([])
    })

    it('is said again for another account on the same device', async () => {
      const { shared } = setUp(() => json(ANSWER), [])
      await shared.refused(WITH_BUCKET, STALE.token, STALE)
      const friend = { ...WITH_BUCKET, me: { ...WITH_BUCKET.me, email: 'friend@example.com' } }
      expect(await shared.automatic(friend, STALE)).toEqual(STALE)
    })
  })
})
