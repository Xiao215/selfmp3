import type { ClientFetch, ClientResponse } from '@selfmp3/client/core'
import type { CloudServer, Health } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { chooseRoute, createRouter, ROUTE_MEMO_MS, type RouteSources } from './connection.js'

/**
 * Which way in wins (docs/features/browser-extension.md, "Connecting (I3)").
 *
 * The three answers the phase is about, each with a fake fetch: a server that
 * answers is asked directly, one that does not sends the link to the bucket,
 * and with no account behind it there is nothing to do but open the options
 * page.
 */

const HOME = 'http://100.64.0.1:4600'
const TAILNET = 'https://mac.tail1234.ts.net'
const TYPED = { baseUrl: 'http://localhost:4600', token: null }

const cloudServer: CloudServer = {
  id: 'the-server',
  addresses: [HOME, TAILNET],
  token: 'from-the-snapshot',
}

/** What `/api/health` says on a server that calls itself `serverId`. */
const healthOf = (serverId: string): Health => ({
  ok: true,
  version: 'test',
  serverId,
  uptimeSeconds: 1,
})

const answer = (status: number, body: unknown): Promise<ClientResponse> =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })

/**
 * A fetch under which `the-server` answers at `live` and nothing else does,
 * counting every address asked. `others` are addresses where a different
 * server answers; `refusing` are ones where `the-server` answers, but no
 * longer takes the library's token.
 */
function answersAt(live: string[], others: string[] = [], refusing: string[] = []) {
  const asked: string[] = []
  const fetch: ClientFetch = url => {
    const { origin, pathname } = new URL(url)
    const at = [...live, ...others, ...refusing].find(address => new URL(address).origin === origin)
    if (pathname === '/api/health') asked.push(at ?? origin)
    if (!at) return Promise.reject(new TypeError('Failed to fetch'))
    if (pathname === '/api/health') {
      return answer(200, healthOf(others.includes(at) ? 'another-server' : 'the-server'))
    }
    return refusing.includes(at)
      ? answer(401, { error: 'invalid token' })
      : answer(200, { version: 1, songCount: 0 })
  }
  return { asked, fetch }
}

function sources(patch: Partial<RouteSources> = {}): RouteSources {
  return {
    typedServer: () => Promise.resolve(null),
    signedIn: () => Promise.resolve(true),
    cloudServer: () => Promise.resolve(cloudServer),
    fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    ...patch,
  }
}

describe('chooseRoute', () => {
  it('asks the server directly when one of its addresses answers', async () => {
    const { fetch, asked } = answersAt([TAILNET])
    const route = await chooseRoute(sources({ fetch }))
    expect(route).toEqual({
      mode: 'server',
      connection: { baseUrl: TAILNET, token: 'from-the-snapshot', serverId: 'the-server' },
      typed: false,
    })
    // Both at once: one address from another network hangs until its timeout.
    expect(asked).toEqual([HOME, TAILNET])
  })

  it('passes over an address where a different server answers', async () => {
    // HOME is answered by somebody else's server (a development server on
    // the same computer, a stranger's on the same Wi-Fi): not this library's.
    const { fetch } = answersAt([TAILNET], [HOME])
    const route = await chooseRoute(sources({ fetch }))
    expect(route.mode === 'server' && route.connection.baseUrl).toBe(TAILNET)
    expect(await chooseRoute(sources({ fetch: answersAt([], [HOME]).fetch }))).toEqual({
      mode: 'bucket',
      noServer: false,
    })
  })

  it('leaves the link in the bucket when no address answers in time', async () => {
    const { fetch } = answersAt([])
    expect(await chooseRoute(sources({ fetch }))).toEqual({ mode: 'bucket', noServer: false })
  })

  it('leaves joining to the app when the bucket names no server, and says none is named', async () => {
    // The app would join the shared server here (sharedServer.ts `automatic`);
    // the extension cannot see whether this device removed it, so it does not.
    // Every address would answer: none is asked, because none is named.
    const { fetch, asked } = answersAt([HOME, TAILNET])
    const route = await chooseRoute(sources({ fetch, cloudServer: () => Promise.resolve(null) }))
    expect(route).toEqual({ mode: 'bucket', noServer: true })
    expect(asked).toEqual([])
  })

  it('finds the shared server through the next snapshot, once the app has joined it', async () => {
    const shared: CloudServer = {
      id: 'the-shared-server',
      addresses: ['https://pi.example.ts.net'],
      token: 'this-account-there',
    }
    let named: CloudServer | null = null
    const fetch: ClientFetch = url => {
      if (!url.startsWith('https://pi.example.ts.net/')) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return url.endsWith('/api/health')
        ? answer(200, healthOf('the-shared-server'))
        : answer(200, { version: 1, songCount: 0 })
    }
    const router = createRouter(sources({ fetch, cloudServer: () => Promise.resolve(named) }))
    expect(await router.route()).toEqual({ mode: 'bucket', noServer: true })

    // The app opened, joined, and the shared server's snapshot named it.
    named = shared
    router.forget()
    expect(await router.route()).toEqual({
      mode: 'server',
      connection: {
        baseUrl: 'https://pi.example.ts.net',
        token: 'this-account-there',
        serverId: 'the-shared-server',
      },
      typed: false,
    })
  })

  it('has nowhere to go without an account, and says so rather than guessing', async () => {
    const { fetch, asked } = answersAt([HOME])
    expect(await chooseRoute(sources({ fetch, signedIn: () => Promise.resolve(false) }))).toEqual({
      mode: 'none',
    })
    // Not signed in means the snapshot's addresses are not even known.
    expect(asked).toEqual([])
  })

  it('prefers the address someone typed in, because they meant it', async () => {
    const { fetch, asked } = answersAt([TYPED.baseUrl, TAILNET])
    const route = await chooseRoute(sources({ fetch, typedServer: () => Promise.resolve(TYPED) }))
    expect(route).toEqual({ mode: 'server', connection: TYPED, typed: true })
    expect(asked).toEqual([TYPED.baseUrl])
  })

  it('falls back from a typed-in server that is asleep to the bucket', async () => {
    const { fetch } = answersAt([])
    expect(
      await chooseRoute(sources({ fetch, typedServer: () => Promise.resolve(TYPED) })),
    ).toEqual({ mode: 'bucket', noServer: false })
  })

  it('is away, not signed out, when a typed-in server is all there is', async () => {
    const { fetch } = answersAt([])
    expect(
      await chooseRoute(
        sources({
          fetch,
          typedServer: () => Promise.resolve(TYPED),
          signedIn: () => Promise.resolve(false),
        }),
      ),
    ).toEqual({ mode: 'away', connection: TYPED })
  })

  it('leaves the link in the bucket when the server named no longer works for this library', async () => {
    // Its account took the grant back: it answers as itself, refuses the
    // token, and the bucket's newest snapshot still names it (2026-10-14).
    const { fetch } = answersAt([], [], [HOME, TAILNET])
    expect(await chooseRoute(sources({ fetch }))).toEqual({ mode: 'bucket', noServer: true })
  })

  it('passes over a typed-in server that refuses its token', async () => {
    const typed = { baseUrl: HOME, token: 'an-old-token' }
    const { fetch } = answersAt([TAILNET], [], [HOME])
    const route = await chooseRoute(sources({ fetch, typedServer: () => Promise.resolve(typed) }))
    expect(route.mode === 'server' && route.connection.baseUrl).toBe(TAILNET)
  })

  it('takes a bucket that cannot be read as a server that has not said where it is', async () => {
    const { fetch } = answersAt([HOME])
    const route = await chooseRoute(
      sources({ fetch, cloudServer: () => Promise.reject(new Error('offline')) }),
    )
    // Not read is not "names none": nothing tells the person to open the app.
    expect(route).toEqual({ mode: 'bucket', noServer: false })
  })
})

describe('createRouter', () => {
  it('keeps one answer for a minute, and lets go when something changes', async () => {
    const { fetch, asked } = answersAt([HOME])
    let now = 1_000
    const router = createRouter(sources({ fetch }), () => now)

    expect((await router.route()).mode).toBe('server')
    await router.route()
    expect(asked.filter(address => address === HOME)).toHaveLength(1)

    now += ROUTE_MEMO_MS + 1
    await router.route()
    expect(asked.filter(address => address === HOME)).toHaveLength(2)

    router.forget()
    await router.route()
    expect(asked.filter(address => address === HOME)).toHaveLength(3)
  })

  it('does not hold on to a failure', async () => {
    let fail = true
    const router = createRouter(
      sources({
        signedIn: () => (fail ? Promise.reject(new Error('storage gone')) : Promise.resolve(false)),
      }),
    )
    await expect(router.route()).rejects.toThrow('storage gone')
    fail = false
    expect(await router.route()).toEqual({ mode: 'none' })
  })

  it('keeps a newer answer when an older one fails after a forget', async () => {
    let calls = 0
    let failFirst: (error: Error) => void = () => undefined
    const router = createRouter(
      sources({
        signedIn: () => {
          calls += 1
          if (calls === 1) return new Promise((_, reject) => (failFirst = reject))
          return Promise.resolve(false)
        },
      }),
    )
    const first = router.route()
    router.forget()
    expect(await router.route()).toEqual({ mode: 'none' })
    failFirst(new Error('stale'))
    await expect(first).rejects.toThrow('stale')
    await router.route()
    expect(calls).toBe(2)
  })
})
