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
const ANSWER = { addresses: [SERVER], token: 'library-token'.padEnd(43, '0') }

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

function setUp(answer: (url: string, method: string) => CloudResponse = () => json(ANSWER)) {
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
      return Promise.resolve(
        json({
          grants: [
            {
              id: '0123456789abcdef',
              server: SERVER,
              name: 'pi',
              createdAt: '2026-10-12T00:00:00.000Z',
            },
          ],
        }),
      )
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
    await shared.removeGrant(ME, '0123456789abcdef')
    expect(doorman).toEqual(['GET /v1/grants', 'DELETE /v1/grants/0123456789abcdef'])
  })
})
