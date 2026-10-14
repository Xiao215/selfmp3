import type { ServerConnection } from '@selfmp3/client/core'
import type { CloudServer, Health } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { chooseRoute, createRouter, ROUTE_MEMO_MS, type RouteSources } from './connection.js'

/**
 * Which way in wins (docs/features/browser-extension.md, "Connecting (I3)").
 *
 * The three answers the phase is about, each with a probe that is a function:
 * a server that answers is asked directly, one that does not sends the link to
 * the bucket, and with no account behind it there is nothing to do but open
 * the options page.
 */

const HOME = 'http://100.64.0.1:4600'
const TAILNET = 'https://mac.tail1234.ts.net'
const TYPED: ServerConnection = { baseUrl: 'http://localhost:4600', token: null }

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

/**
 * A probe that answers for these addresses and nothing else, counting every
 * ask; `others` are addresses where a different server answers.
 */
function answersAt(live: string[], others: string[] = []) {
  const asked: string[] = []
  return {
    asked,
    probe: (connection: ServerConnection): Promise<Health | null> => {
      asked.push(connection.baseUrl)
      if (others.includes(connection.baseUrl)) return Promise.resolve(healthOf('another-server'))
      return Promise.resolve(live.includes(connection.baseUrl) ? healthOf('the-server') : null)
    },
  }
}

function sources(patch: Partial<RouteSources> = {}): RouteSources {
  return {
    typedServer: () => Promise.resolve(null),
    signedIn: () => Promise.resolve(true),
    cloudServer: () => Promise.resolve(cloudServer),
    probe: () => Promise.resolve(null),
    ...patch,
  }
}

describe('chooseRoute', () => {
  it('asks the server directly when one of its addresses answers', async () => {
    const { probe, asked } = answersAt([TAILNET])
    const route = await chooseRoute(sources({ probe }))
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
    const { probe } = answersAt([TAILNET], [HOME])
    const route = await chooseRoute(sources({ probe }))
    expect(route.mode === 'server' && route.connection.baseUrl).toBe(TAILNET)
    expect(await chooseRoute(sources({ probe: answersAt([], [HOME]).probe }))).toEqual({
      mode: 'bucket',
    })
  })

  it('leaves the link in the bucket when no address answers in time', async () => {
    const { probe } = answersAt([])
    expect(await chooseRoute(sources({ probe }))).toEqual({ mode: 'bucket' })
  })

  it('has nowhere to go without an account, and says so rather than guessing', async () => {
    const { probe, asked } = answersAt([HOME])
    expect(await chooseRoute(sources({ probe, signedIn: () => Promise.resolve(false) }))).toEqual({
      mode: 'none',
    })
    // Not signed in means the snapshot's addresses are not even known.
    expect(asked).toEqual([])
  })

  it('prefers the address someone typed in, because they meant it', async () => {
    const { probe, asked } = answersAt([TYPED.baseUrl, TAILNET])
    const route = await chooseRoute(sources({ probe, typedServer: () => Promise.resolve(TYPED) }))
    expect(route).toEqual({ mode: 'server', connection: TYPED, typed: true })
    expect(asked).toEqual([TYPED.baseUrl])
  })

  it('falls back from a typed-in server that is asleep to the bucket', async () => {
    const { probe } = answersAt([])
    expect(
      await chooseRoute(sources({ probe, typedServer: () => Promise.resolve(TYPED) })),
    ).toEqual({ mode: 'bucket' })
  })

  it('is away, not signed out, when a typed-in server is all there is', async () => {
    const { probe } = answersAt([])
    expect(
      await chooseRoute(
        sources({
          probe,
          typedServer: () => Promise.resolve(TYPED),
          signedIn: () => Promise.resolve(false),
        }),
      ),
    ).toEqual({ mode: 'away', connection: TYPED })
  })

  it('takes a bucket that cannot be read as a server that has not said where it is', async () => {
    const { probe } = answersAt([HOME])
    const route = await chooseRoute(
      sources({ probe, cloudServer: () => Promise.reject(new Error('offline')) }),
    )
    expect(route).toEqual({ mode: 'bucket' })
  })
})

describe('createRouter', () => {
  it('keeps one answer for a minute, and lets go when something changes', async () => {
    const { probe, asked } = answersAt([HOME])
    let now = 1_000
    const router = createRouter(sources({ probe }), () => now)

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
