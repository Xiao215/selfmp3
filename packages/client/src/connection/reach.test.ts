import { describe, expect, it } from 'vitest'
import type { ClientFetch, ClientRequestInit } from '../platform.js'
import type { ServerConnection } from './connection.js'
import {
  answersAs,
  askAddress,
  awayCopy,
  CONFIRM_AWAY_MS,
  candidates,
  reachServer,
  reachServerAgain,
  type Answer,
  type Candidate,
} from './reach.js'

const server = {
  id: 'the-pi',
  addresses: ['http://localhost:4600', 'http://192.168.1.20:4600', 'http://100.101.1.2:4600'],
  token: 'secret-token',
}

describe('candidates', () => {
  it('turns each address into a connection carrying the token and the server it is for', () => {
    expect(candidates(server)).toEqual([
      { baseUrl: 'http://localhost:4600', token: 'secret-token', serverId: 'the-pi' },
      { baseUrl: 'http://192.168.1.20:4600', token: 'secret-token', serverId: 'the-pi' },
      { baseUrl: 'http://100.101.1.2:4600', token: 'secret-token', serverId: 'the-pi' },
    ])
    expect(candidates(null)).toEqual([])
  })
})

describe('reachServer', () => {
  const answers = (by: Record<string, Promise<Answer>>) => (connection: ServerConnection) =>
    by[connection.baseUrl] ?? Promise.resolve(null)

  it('takes the first address that answers, without waiting on the ones that hang', async () => {
    let hangUp: (answer: Answer) => void = () => undefined
    const hanging = new Promise<Answer>(resolve => {
      hangUp = resolve
    })
    const found = await reachServer(
      candidates(server),
      answers({
        'http://localhost:4600': hanging,
        'http://192.168.1.20:4600': Promise.resolve('works'),
      }),
    )
    expect(found !== 'refused' && found?.baseUrl).toBe('http://192.168.1.20:4600')
    hangUp(null)
  })

  it('is null when no address answers, a refused connection and a failure alike', async () => {
    const found = await reachServer(
      candidates(server),
      answers({
        'http://localhost:4600': Promise.reject(new Error('connection refused')),
        'http://192.168.1.20:4600': Promise.resolve(null),
      }),
    )
    expect(found).toBeNull()
  })

  it('says refused when the server answered and refused the token, and nowhere worked', async () => {
    const found = await reachServer(
      candidates(server),
      answers({
        'http://localhost:4600': Promise.reject(new Error('connection refused')),
        'http://100.101.1.2:4600': Promise.resolve('refuses'),
      }),
    )
    expect(found).toBe('refused')
  })

  it('takes an address that works over one that refuses', async () => {
    const found = await reachServer(
      candidates(server),
      answers({
        'http://192.168.1.20:4600': Promise.resolve('refuses'),
        'http://100.101.1.2:4600': Promise.resolve('works'),
      }),
    )
    expect(found !== 'refused' && found?.baseUrl).toBe('http://100.101.1.2:4600')
  })

  it('is null at once with no addresses to try', async () => {
    let asked = 0
    const found = await reachServer([], () => {
      asked++
      return Promise.resolve('works' as const)
    })
    expect(found).toBeNull()
    expect(asked).toBe(0)
  })
})

describe('answersAs', () => {
  const [home] = candidates(server) as [Candidate]
  const health = (serverId: string) => ({ ok: true, version: '1', serverId, uptimeSeconds: 3 })

  it('takes the server the snapshot named, and no other', () => {
    expect(answersAs(health('the-pi'), home)).toBe(true)
    expect(answersAs(health('a-development-server'), home)).toBe(false)
  })

  it('takes nothing that is not a health answer at all', () => {
    expect(answersAs(null, home)).toBe(false)
    expect(answersAs({ ok: true }, home)).toBe(false)
    expect(answersAs('<html>a router’s login page</html>', home)).toBe(false)
  })

  /*
   * 2026-10-14: the real app on the Mac, signed in to a library served from
   * the Pi, raced the Pi's addresses — `http://localhost:4600` among them,
   * which the Pi published for itself. On the Mac that is the development
   * server, which answered first, was taken, and refused every request after
   * (the Pi's token, another library). It is passed over now.
   */
  it('passes over localhost when a development server answers there', async () => {
    const said: Record<string, unknown> = {
      'http://localhost:4600': health('a-development-server'),
      'http://192.168.1.20:4600': health('the-pi'),
    }
    const probe = async (candidate: Candidate) => {
      // The development server is on this computer, so it answers first.
      if (candidate.baseUrl !== 'http://localhost:4600') await Promise.resolve()
      return answersAs(said[candidate.baseUrl] ?? null, candidate) ? ('works' as const) : null
    }
    const found = await reachServer(candidates(server), probe)
    expect(found !== 'refused' && found?.baseUrl).toBe('http://192.168.1.20:4600')
  })
})

describe('reachServerAgain', () => {
  const [home] = candidates(server)
  /** Answers from a script, one look's worth of answers per entry. */
  const looks = (...answers: Answer[]) => {
    let look = 0
    return {
      probe: () => Promise.resolve(answers[Math.floor(look++ / server.addresses.length)] ?? null),
      looked: () => look / server.addresses.length,
    }
  }
  const waited: number[] = []
  const wait = (ms: number) => {
    waited.push(ms)
    return Promise.resolve()
  }

  it('keeps a server that was answering through one missed look', async () => {
    waited.length = 0
    const { probe, looked } = looks(null, 'works')
    const found = await reachServerAgain(candidates(server), probe, home, wait)
    expect(found).not.toBeNull()
    expect(looked()).toBe(2)
    expect(waited).toEqual([CONFIRM_AWAY_MS])
  })

  it('gives it up after a second miss', async () => {
    const { probe, looked } = looks(null, null)
    expect(await reachServerAgain(candidates(server), probe, home, wait)).toBeNull()
    expect(looked()).toBe(2)
  })

  it('says a server never found is away at the first miss, without waiting', async () => {
    waited.length = 0
    for (const before of [null, undefined]) {
      const { probe, looked } = looks(null, 'works')
      expect(await reachServerAgain(candidates(server), probe, before, wait)).toBeNull()
      expect(looked()).toBe(1)
    }
    expect(waited).toEqual([])
  })

  it('says a refusal at once: it is the server’s own answer, not a blip', async () => {
    waited.length = 0
    const { probe, looked } = looks('refuses', 'works')
    expect(await reachServerAgain(candidates(server), probe, home, wait)).toBe('refused')
    expect(looked()).toBe(1)
    expect(waited).toEqual([])
  })

  it('looks once when the server answers', async () => {
    const { probe, looked } = looks('works')
    expect(await reachServerAgain(candidates(server), probe, home, wait)).not.toBeNull()
    expect(looked()).toBe(1)
  })
})

describe('askAddress', () => {
  const [home] = candidates(server) as [Candidate]
  const health = (serverId: string) => ({ ok: true, version: '1', serverId, uptimeSeconds: 3 })

  /** A fetch answering `/api/health` as `serverId` and the library's version with `status`. */
  function serving(serverId: string, status: number) {
    const sent: { path: string; auth: string | undefined }[] = []
    const fetch: ClientFetch = (url: string, init?: ClientRequestInit) => {
      const path = new URL(url).pathname
      sent.push({ path, auth: init?.headers?.['Authorization'] })
      const body = path === '/api/health' ? health(serverId) : { version: 1, songCount: 0 }
      const code = path === '/api/health' ? 200 : status
      return Promise.resolve({
        ok: code < 300,
        status: code,
        json: () => Promise.resolve(body),
      })
    }
    return { fetch, sent }
  }

  it('asks the token only of the server the snapshot named', async () => {
    const { fetch, sent } = serving('a-development-server', 200)
    expect(await askAddress(fetch, home)).toBeNull()
    expect(sent).toEqual([{ path: '/api/health', auth: undefined }])
  })

  it('works when that server takes the token', async () => {
    const { fetch, sent } = serving('the-pi', 200)
    expect(await askAddress(fetch, home)).toBe('works')
    expect(sent).toEqual([
      { path: '/api/health', auth: undefined },
      { path: '/api/library/version', auth: 'Bearer secret-token' },
    ])
  })

  /*
   * 2026-10-14: the shared server's grant was removed, it let the library go,
   * and the bucket's newest snapshot still named it — its id answering, its
   * token refused. Every device kept choosing it.
   */
  it('refuses when that server no longer takes the token', async () => {
    const { fetch } = serving('the-pi', 401)
    expect(await askAddress(fetch, home)).toBe('refuses')
  })

  it('is null when nothing answers', async () => {
    expect(await askAddress(() => Promise.reject(new TypeError('offline')), home)).toBeNull()
  })
})

describe('awayCopy', () => {
  it('tells a server that is off apart from one that never said where it is', () => {
    expect(awayCopy(true, 'import').title).toBe('Your library’s computer isn’t answering')
    expect(awayCopy(false, 'import').title).toBe('Your library’s computer hasn’t said where it is')
    // Import is the exception: there is something to do here, so it says that
    // rather than telling anyone to go and start their server.
    expect(awayCopy(false, 'import').body).toBe('You can still add a link below.')
    expect(awayCopy(false, 'import').why).toContain('downloaded the next time that computer is on')
    expect(awayCopy(false, 'stats').body).toBe('Your songs still play.')
    expect(awayCopy(false, 'stats').why).toContain('let it run for a minute')
  })

  it('offers the shared computer to a library that never had one', () => {
    const offer = awayCopy(false, 'stats', true)
    expect(offer.title).toBe('No computer works for your library yet')
    expect(offer.why).toContain('Stats are worked out on your library’s computer')
    expect(offer.why).toContain('The shared computer can')
    // A computer of its own that is only off is not offered a different one.
    expect(awayCopy(true, 'stats', true).title).toBe('Your library’s computer isn’t answering')
  })

  it('does not tell a library with no songs yet that its songs still play', () => {
    expect(awayCopy(false, 'stats', true, true).body).toBe('Your library has no songs yet.')
    // Import's line is about adding, which an empty library is there to do.
    expect(awayCopy(false, 'import', true, true).body).toBe('You can still add a link below.')
  })

  it('leads with what this screen came for, so the card is not the same card everywhere', () => {
    expect(awayCopy(true, 'import').why).toContain('Importing goes through your library’s computer')
    expect(awayCopy(true, 'stats').why).toContain('Stats are worked out on your library’s computer')
    expect(awayCopy(true, 'metadata').why).toContain(
      'Looking a song up goes through your library’s computer',
    )
  })
})
