import type { ServerConnection } from '@selfmp3/client/core'
import type { CloudServer } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { chooseRoute, createRouter, ROUTE_MEMO_MS, type RouteSources } from './connection.js'

/**
 * Which way in wins (I3, docs/EXTENSION.md, Phase 5's gate).
 *
 * The three answers the phase is about, each with a probe that is a function:
 * a server that answers is asked directly, one that does not sends the link to
 * the bucket, and with no account behind it there is nothing to do but open
 * the options page.
 */

const HOME = 'http://100.64.0.1:4600'
const TAILNET = 'https://mac.tail1234.ts.net'
const TYPED: ServerConnection = { baseUrl: 'http://localhost:4600', token: null }

const cloudServer: CloudServer = { addresses: [HOME, TAILNET], token: 'from-the-snapshot' }

/** A probe that answers for these addresses and nothing else, counting every ask. */
function answersAt(...live: string[]) {
  const asked: string[] = []
  return {
    asked,
    probe: (connection: ServerConnection): Promise<boolean> => {
      asked.push(connection.baseUrl)
      return Promise.resolve(live.includes(connection.baseUrl))
    },
  }
}

function sources(patch: Partial<RouteSources> = {}): RouteSources {
  return {
    typedServer: () => Promise.resolve(null),
    signedIn: () => Promise.resolve(true),
    cloudServer: () => Promise.resolve(cloudServer),
    probe: () => Promise.resolve(false),
    ...patch,
  }
}

describe('chooseRoute', () => {
  it('asks the server directly when one of its addresses answers', async () => {
    const { probe, asked } = answersAt(TAILNET)
    const route = await chooseRoute(sources({ probe }))
    expect(route).toEqual({
      mode: 'server',
      connection: { baseUrl: TAILNET, token: 'from-the-snapshot' },
      typed: false,
    })
    // Both at once: one address from another network hangs until its timeout.
    expect(asked).toEqual([HOME, TAILNET])
  })

  it('leaves the link in the bucket when no address answers in time', async () => {
    const { probe } = answersAt()
    expect(await chooseRoute(sources({ probe }))).toEqual({ mode: 'bucket' })
  })

  it('has nowhere to go without an account, and says so rather than guessing', async () => {
    const { probe, asked } = answersAt(HOME)
    expect(await chooseRoute(sources({ probe, signedIn: () => Promise.resolve(false) }))).toEqual({
      mode: 'none',
    })
    // Not signed in means the snapshot's addresses are not even known.
    expect(asked).toEqual([])
  })

  it('prefers the address someone typed in, because they meant it', async () => {
    const { probe, asked } = answersAt(TYPED.baseUrl, TAILNET)
    const route = await chooseRoute(sources({ probe, typedServer: () => Promise.resolve(TYPED) }))
    expect(route).toEqual({ mode: 'server', connection: TYPED, typed: true })
    expect(asked).toEqual([TYPED.baseUrl])
  })

  it('falls back from a typed-in server that is asleep to the bucket', async () => {
    const { probe } = answersAt()
    expect(
      await chooseRoute(sources({ probe, typedServer: () => Promise.resolve(TYPED) })),
    ).toEqual({ mode: 'bucket' })
  })

  it('is away, not signed out, when a typed-in server is all there is', async () => {
    const { probe } = answersAt()
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
    const { probe } = answersAt(HOME)
    const route = await chooseRoute(
      sources({ probe, cloudServer: () => Promise.reject(new Error('offline')) }),
    )
    expect(route).toEqual({ mode: 'bucket' })
  })
})

describe('createRouter', () => {
  it('keeps one answer for a minute, and lets go when something changes', async () => {
    const { probe, asked } = answersAt(HOME)
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
})
