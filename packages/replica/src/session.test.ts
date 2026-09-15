import { describe, expect, it } from 'vitest'
import { DoormanError, SESSION_KEY, createCloudSession } from './session.js'
import type { CloudPlatform, CloudRequestInit, CloudResponse, DeviceStore } from './platform.js'

/**
 * These are the first tests this code has ever had. It moved out of the web
 * app unchanged, where it could not be tested without a browser — which is
 * most of the argument for the port it now sits behind: the fake below is
 * thirty lines, and it can answer 401 on demand.
 */

const DOORMAN = 'https://doorman.test'

function memoryStore(): DeviceStore & { seen: Map<string, unknown> } {
  const seen = new Map<string, unknown>()
  return {
    seen,
    read: key => Promise.resolve(seen.has(key) ? seen.get(key) : null),
    write: (key, value) => {
      // Through JSON, as every real store does, so nothing passes a live
      // object reference between writer and reader and quietly works.
      seen.set(key, JSON.parse(JSON.stringify(value)))
      return Promise.resolve()
    },
    remove: key => {
      seen.delete(key)
      return Promise.resolve()
    },
  }
}

interface Call {
  readonly url: string
  readonly init: CloudRequestInit | undefined
}

function reply(status: number, body: unknown): CloudResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }
}

function platform(
  answer: (call: Call) => CloudResponse | Promise<CloudResponse>,
  overrides: Partial<CloudPlatform> = {},
): CloudPlatform & { calls: Call[]; opened: string[]; store: ReturnType<typeof memoryStore> } {
  const calls: Call[] = []
  const opened: string[] = []
  const store = memoryStore()
  return {
    calls,
    opened,
    store,
    doormanUrl: DOORMAN,
    fetch: (url, init) => {
      const call = { url, init }
      calls.push(call)
      return Promise.resolve(answer(call))
    },
    // Not random, deliberately: the attempt id is asserted on below.
    randomBytes: into => into.fill(7),
    returnUrl: 'https://app.test/selfmp3/',
    openSignIn: url => {
      opened.push(url)
    },
    ...overrides,
  }
}

const ME = { email: 'someone@example.com', name: 'Someone', picture: null, storage: null }
/** The doorman's tokens are at least thirty-two characters, and the schema says so. */
const TOKEN = 'tok'.padEnd(32, '0')

describe('a session', () => {
  it('is not loaded back when it belongs to a different doorman', async () => {
    // A build pointed somewhere new starts signed out rather than confused,
    // because a session means nothing to a doorman that did not issue it.
    const p = platform(() => reply(200, {}))
    const session = createCloudSession(p)
    await p.store.write(SESSION_KEY, {
      doormanUrl: 'https://somewhere.else',
      token: 't',
      me: ME,
    })
    expect(await session.loadSession()).toBeNull()
  })

  it('is not loaded back when what was stored is not a session', async () => {
    const p = platform(() => reply(200, {}))
    const session = createCloudSession(p)
    await p.store.write(SESSION_KEY, { doormanUrl: DOORMAN, token: 't', me: { nonsense: true } })
    expect(await session.loadSession()).toBeNull()
  })

  it('survives a store that throws rather than taking the app down', async () => {
    const p = platform(() => reply(200, {}))
    const broken: DeviceStore = {
      read: () => Promise.reject(new Error('no storage in a private window')),
      write: () => Promise.reject(new Error('no storage')),
      remove: () => Promise.reject(new Error('no storage')),
    }
    const session = createCloudSession({ ...p, store: broken })
    expect(await session.loadSession()).toBeNull()
    expect(await session.pendingSignIn()).toBeNull()
    await expect(session.forgetSession()).resolves.toBeUndefined()
  })
})

describe('signing in', () => {
  it('remembers the attempt before leaving, and asks to be returned to', async () => {
    const p = platform(() => reply(200, {}))
    const session = createCloudSession(p, () => 1_000)
    await session.beginSignIn()

    const pending = await session.pendingSignIn()
    expect(pending?.attempt).toBe('07'.repeat(16))
    // Remembered before the app leaves, or there is nothing to come back to.
    expect(p.opened).toHaveLength(1)
    expect(p.opened[0]).toContain(`${DOORMAN}/v1/auth/start?attempt=${'07'.repeat(16)}`)
    expect(p.opened[0]).toContain('return=https%3A%2F%2Fapp.test%2Fselfmp3%2F')
  })

  it('asks for no return address on a device that cannot be returned to', async () => {
    // The native case: there is no page to come back to, so the doorman shows
    // a code instead and the app asks for it.
    const p = platform(() => reply(200, {}), { returnUrl: null })
    const session = createCloudSession(p)
    await session.beginSignIn()
    expect(p.opened[0]).not.toContain('return=')
  })

  it('forgets an attempt once it is too old to be claimed', async () => {
    let clock = 1_000
    const p = platform(() => reply(200, {}))
    const session = createCloudSession(p, () => clock)
    await session.beginSignIn()
    expect(await session.pendingSignIn()).not.toBeNull()

    clock += 11 * 60_000
    expect(await session.pendingSignIn()).toBeNull()
  })

  it('spends a code once, however often the page asks', async () => {
    // React runs an effect twice in development, and a page may be reopened;
    // the doorman lets a code be spent once, so the second go must be the first.
    const p = platform(() => reply(200, { status: 'signed-in', token: TOKEN, me: ME }))
    const session = createCloudSession(p)

    const [a, b] = await Promise.all([
      session.claimSignIn('attempt', '123456'),
      session.claimSignIn('attempt', '123456'),
    ])
    expect(a).toEqual(b)
    expect(p.calls.filter(c => c.url.endsWith('/v1/auth/claim'))).toHaveLength(1)
  })

  it('lets a code be tried again when the answer never arrived', async () => {
    // No answer is not a refusal: the code may still be good.
    let attempt = 0
    const p = platform(() => {
      attempt += 1
      if (attempt === 1) throw new Error('offline')
      return reply(200, { status: 'signed-in', token: TOKEN, me: ME })
    })
    const session = createCloudSession(p)

    await expect(session.claimSignIn('a', '123456')).rejects.toBeInstanceOf(DoormanError)
    const outcome = await session.claimSignIn('a', '123456')
    expect(outcome.status).toBe('signed-in')
  })

  it('does not retry a code the doorman refused', async () => {
    const p = platform(() => reply(400, { error: 'that was not the code', code: 'wrong_code' }))
    const session = createCloudSession(p)

    await expect(session.claimSignIn('a', '000000')).rejects.toMatchObject({ code: 'wrong_code' })
    await expect(session.claimSignIn('a', '000000')).rejects.toMatchObject({ code: 'wrong_code' })
    // Once, not twice: a refusal is final, and the attempt is over.
    expect(p.calls).toHaveLength(1)
  })

  it('keeps the session and forgets the attempt once Google is done', async () => {
    const p = platform(() => reply(200, { status: 'signed-in', token: TOKEN, me: ME }))
    const session = createCloudSession(p)
    await session.beginSignIn()

    const outcome = await session.claimSignIn('attempt', '123456')
    expect(outcome.status).toBe('signed-in')
    expect(await session.loadSession()).toMatchObject({ token: TOKEN, doormanUrl: DOORMAN })
    // The attempt is spent; nothing should be able to claim it again.
    expect(await session.pendingSignIn()).toBeNull()
  })
})

describe('talking to the doorman', () => {
  it('carries the session as a bearer token, and only when there is one', async () => {
    const p = platform(() => reply(200, {}))
    const session = createCloudSession(p)
    const signedIn = { doormanUrl: DOORMAN, token: TOKEN, me: ME }

    await session.doormanFetch(signedIn, '/v1/me')
    await session.doormanFetch(null, '/v1/auth/claim', { method: 'POST', json: { a: 1 } })

    expect(p.calls[0]?.init?.headers?.['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(p.calls[1]?.init?.headers?.['Authorization']).toBeUndefined()
    expect(p.calls[1]?.init?.headers?.['Content-Type']).toBe('application/json')
  })

  it('turns no answer at all into status 0, which the app reads as offline', async () => {
    const p = platform(() => {
      throw new Error('network unavailable')
    })
    const session = createCloudSession(p)
    await expect(session.doormanFetch(null, '/v1/me')).rejects.toMatchObject({ status: 0 })
  })

  it("carries the doorman's own words rather than inventing any", async () => {
    const p = platform(() => reply(403, { error: 'that address is not on the list', code: 'nope' }))
    const session = createCloudSession(p)
    await expect(session.doormanFetch(null, '/v1/me')).rejects.toMatchObject({
      status: 403,
      message: 'that address is not on the list',
      code: 'nope',
    })
  })

  it('hands back a 404 instead of throwing, since a missing file is an answer', async () => {
    const p = platform(() => reply(404, {}))
    const session = createCloudSession(p)
    await expect(session.doormanFetch(null, '/v1/files/x')).resolves.toMatchObject({ status: 404 })
  })

  it('refuses to reach a doorman that was never configured', async () => {
    const p = platform(() => reply(200, {}), { doormanUrl: '' })
    const session = createCloudSession(p)
    await expect(session.doormanFetch(null, '/v1/me')).rejects.toMatchObject({ code: 'no-doorman' })
    expect(p.calls).toHaveLength(0)
  })

  it('forgets the session on signing out even when the doorman cannot be told', async () => {
    const p = platform(() => {
      throw new Error('offline')
    })
    const session = createCloudSession(p)
    const signedIn = { doormanUrl: DOORMAN, token: TOKEN, me: ME }
    await session.saveSession(signedIn)

    await session.signOut(signedIn)
    expect(await session.loadSession()).toBeNull()
  })
})
