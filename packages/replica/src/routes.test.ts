import { describe, expect, it, vi } from 'vitest'
import { API_ERROR, type CloudSnapshot } from '@selfmp3/shared'
import { createCloudLibrary } from './library.js'
import type { CloudPlatform, CloudResponse, DeviceStore } from './platform.js'
import { createCloudRoutes, parseQuery } from './routes.js'
import { createCloudSession, type CloudSession } from './session.js'

/**
 * Hand-written, because React Native's `URL` carries no `URLSearchParams`.
 * The cases below are the ones a hand-written parser gets wrong, checked
 * against what `URLSearchParams` answers — matching it exactly is the whole
 * requirement.
 */
describe('parseQuery', () => {
  const cases = [
    '?scope=playlists',
    'scope=playlists',
    '?limit=20&scope=library',
    '?a=1&a=2',
    '?flag',
    '?flag=',
    '?q=two%20words',
    '?q=two+words',
    '?q=a%26b',
    '?weird=%E2%9C%93',
    '?q=100%',
    '?q=%E2%9C%93%zz',
    '',
    '?',
    '?&&',
  ]

  for (const search of cases) {
    it(`reads ${search || '(empty)'} the way a browser would`, () => {
      const mine = parseQuery(search)
      const theirs = new URLSearchParams(search)
      for (const key of ['scope', 'limit', 'a', 'flag', 'q', 'weird', 'missing']) {
        expect([key, mine.get(key)]).toEqual([key, theirs.get(key)])
      }
    })
  }
})

/**
 * `/api/cloud/uids`: this device's half of the table that lines its song ids
 * up with a server's (@selfmp3/client serverIds.ts). The uids are the bucket's;
 * the ids are whatever this device handed out as they arrived, so the pairing
 * is the only thing that carries across.
 */
describe('/api/cloud/uids', () => {
  const DOORMAN = 'https://doorman.test'
  const SESSION: CloudSession = {
    doormanUrl: DOORMAN,
    token: 'tok'.padEnd(32, '0'),
    me: { email: 'a@b.c', name: null, picture: null, storage: null },
  }
  const uid = (letter: string) => letter.repeat(32)

  const song = (letter: string, title: string) => ({
    uid: uid(letter),
    title,
    artist: '',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 200,
    audio: { key: `audio/${letter.repeat(64)}.m4a`, size: 4_000_000, mime: 'audio/mp4' },
    cover: null,
    coverTone: null,
    lyrics: null,
    motion: null,
    instrumental: false,
    loved: false,
    playCount: 0,
    lastPlayedAt: null,
    addedAt: '2026-09-01 10:00:00',
    sourceUrl: null,
    tagUids: [],
    audioFeatures: null,
  })

  const SNAPSHOT: CloudSnapshot = {
    format: 1,
    writtenAt: '2026-09-11T10:00:00.000Z',
    writtenBy: 'mac-3f9a1c2e',
    upTo: {},
    songs: [song('a', 'Song a'), { ...song('b', 'Song b'), instrumental: true }],
    tags: [],
    playlists: [
      {
        uid: uid('7'),
        name: 'Mix',
        description: '',
        kind: 'manual',
        rules: null,
        pinned: false,
        songUids: [uid('a')],
        createdAt: '2026-09-01 10:00:00',
        updatedAt: '2026-09-01 10:00:00',
      },
    ],
    artists: [],
    sound: null,
  }

  /**
   * Enough of a store and a bucket to read one snapshot through. The doorman's
   * health is a captive portal by default: a 200 that is not the doorman's.
   * `snapshotBytes`, when given, is what the snapshot reads as instead.
   */
  function device(health: unknown = '<html>Sign in to the Wi-Fi</html>', snapshotBytes?: string) {
    const data = new Map<string, unknown>()
    const clone = (value: unknown): unknown =>
      value === undefined ? null : JSON.parse(JSON.stringify(value))
    const store: DeviceStore = {
      read: key => Promise.resolve(data.has(key) ? clone(data.get(key)) : null),
      write: (key, value) => {
        data.set(key, clone(value))
        return Promise.resolve()
      },
      remove: key => {
        data.delete(key)
        return Promise.resolve()
      },
      update: (key, change) => {
        const next = change(data.has(key) ? clone(data.get(key)) : null)
        data.set(key, clone(next))
        return Promise.resolve(clone(next))
      },
    }

    const files = new Map<string, unknown>([
      ['snapshots/20260911T100000000Z-mac-3f9a1c2e.json', SNAPSHOT],
    ])
    const reply = (status: number, body: unknown): Promise<CloudResponse> =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).slice().buffer),
      })

    const fetched: string[] = []
    const platform: CloudPlatform = {
      doormanUrl: DOORMAN,
      sharedServerUrl: '',
      store,
      fetch: (url: string) => {
        const path = url.slice(DOORMAN.length)
        fetched.push(path)
        if (path.startsWith('/v1/list')) {
          const prefix = decodeURIComponent(/prefix=([^&]*)/.exec(path)?.[1] ?? '')
          return reply(200, {
            objects: [...files.keys()]
              .filter(key => key.startsWith(prefix))
              .map(key => ({ key, size: 1 })),
            cursor: null,
          })
        }
        if (path === '/v1/health') return reply(200, health)
        if (path.startsWith('/v1/files/')) {
          const key = path.slice('/v1/files/'.length)
          if (snapshotBytes !== undefined && key.startsWith('snapshots/')) {
            return reply(200, null).then(response => ({
              ...response,
              arrayBuffer: () =>
                Promise.resolve(new TextEncoder().encode(snapshotBytes).slice().buffer),
            }))
          }
          return files.has(key) ? reply(200, files.get(key)) : reply(404, {})
        }
        return reply(404, {})
      },
      randomBytes: into => into.fill(3),
      returnUrl: null,
      openSignIn: () => undefined,
      deviceKind: 'test',
      onWake: () => undefined,
      decodeText: bytes => Promise.resolve(new TextDecoder().decode(bytes)),
      textCache: {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        clear: () => Promise.resolve(),
      },
      warn: () => undefined,
    }

    const session = createCloudSession(platform)
    const library = createCloudLibrary(platform, session)
    return { session, fetched, ...createCloudRoutes(platform, session, library) }
  }

  it('names the uid behind each id this device handed out', async () => {
    const made = device()
    await made.session.saveSession(SESSION)

    const answer = (await made.cloudRequest('GET', '/api/cloud/uids', undefined)) as {
      songs: { id: number; uid: string }[]
    }
    const byUid = new Map(answer.songs.map(row => [row.uid, row.id]))

    expect(answer.songs).toHaveLength(2)
    expect(byUid.has(uid('a'))).toBe(true)
    expect(byUid.has(uid('b'))).toBe(true)
    // The ids are this device's own, and each names the song the library shows
    // under it — which is the whole point of answering at all.
    const library = (await made.cloudRequest('GET', '/api/library', undefined)) as {
      songs: { id: number; title: string }[]
    }
    const titleOf = new Map(library.songs.map(row => [row.id, row.title]))
    expect(titleOf.get(byUid.get(uid('a')) ?? 0)).toBe('Song a')
    expect(titleOf.get(byUid.get(uid('b')) ?? 0)).toBe('Song b')
  })

  it('answers it, and where the server is, from the copy however long since a look', async () => {
    // Every screen that might use the server asks for both every few seconds.
    // As library reads they looked at the bucket, two counted listings, every
    // eighty seconds the app was open.
    const made = device()
    await made.session.saveSession(SESSION)
    await made.cloudRequest('GET', '/api/cloud/server', undefined)
    const asked = made.fetched.length

    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + 60 * 60_000)
      for (let i = 0; i < 3; i++) {
        await made.cloudRequest('GET', '/api/cloud/server', undefined)
        await made.cloudRequest('GET', '/api/cloud/uids', undefined)
      }
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(made.fetched.slice(asked)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('needs a session, like every other route that reads the bucket', async () => {
    await expect(device().cloudRequest('GET', '/api/cloud/uids', undefined)).rejects.toMatchObject({
      status: 401,
    })
  })

  it('calls a 200 that is not the doorman’s offline, not an answer', async () => {
    await expect(device().cloudRequest('GET', '/api/health', undefined)).rejects.toMatchObject({
      status: 0,
      code: 'offline',
    })
  })

  /*
   * The bucket's own data is not the app's mistake, and not the network being
   * away either: a snapshot that is not JSON at all says so the way one of the
   * wrong shape does, rather than reading as "offline".
   */
  it('calls a snapshot that does not read an unexpected answer, not offline', async () => {
    for (const bytes of ['{"format": 1, "songs": [', JSON.stringify({ format: 'one' })]) {
      const made = device(undefined, bytes)
      await made.session.saveSession(SESSION)
      await expect(made.cloudRequest('GET', '/api/library', undefined)).rejects.toMatchObject({
        status: 502,
        code: 'contract_mismatch',
      })
    }
  })

  it('answers for a doorman that is there, with no song count it does not know', async () => {
    const health = await device({ ok: true, version: '1.0.0' }).cloudRequest(
      'GET',
      '/api/health',
      undefined,
    )
    expect(health).toMatchObject({ ok: true, version: 'web' })
    expect(health).not.toHaveProperty('songCount')
  })

  /** A signed-in device, and the id it gave each song and the playlist. */
  async function signedIn() {
    const made = device()
    await made.session.saveSession(SESSION)
    const library = (await made.cloudRequest('GET', '/api/library', undefined)) as {
      songs: { id: number; title: string }[]
      playlists: { id: number; lastPlayedAt: string | null }[]
    }
    const songId = (title: string) => library.songs.find(row => row.title === title)?.id ?? 0
    return { made, a: songId('Song a'), b: songId('Song b'), mix: library.playlists[0]?.id ?? 0 }
  }

  it('says a song with no words is instrumental the way the server does', async () => {
    const { made, a, b } = await signedIn()
    await expect(
      made.cloudRequest('GET', `/api/songs/${a}/lyrics`, undefined),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await expect(
      made.cloudRequest('GET', `/api/songs/${b}/lyrics`, undefined),
    ).rejects.toMatchObject({ status: 404, code: 'instrumental' })
  })

  it('answers a play sent again as the duplicate it is', async () => {
    const { made, a } = await signedIn()
    const play = { msPlayed: 90_000, completed: true, clientId: 'outbox-0001' }
    const path = `/api/songs/${a}/played`
    expect(await made.cloudRequest('POST', path, play)).toEqual({ ok: true, duplicate: false })
    expect(await made.cloudRequest('POST', path, play)).toEqual({ ok: true, duplicate: true })
    const library = (await made.cloudRequest('GET', '/api/library', undefined)) as {
      songs: { id: number; playCount: number }[]
    }
    expect(library.songs.find(row => row.id === a)?.playCount).toBe(1)
  })

  it('keeps when a playlist was last started, on this device', async () => {
    const { made, mix } = await signedIn()
    expect(await made.cloudRequest('POST', `/api/playlists/${mix}/played`, undefined)).toEqual({
      ok: true,
    })
    const library = (await made.cloudRequest('GET', '/api/library', undefined)) as {
      playlists: { id: number; lastPlayedAt: string | null }[]
    }
    expect(library.playlists[0]?.lastPlayedAt).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
    await expect(
      made.cloudRequest('POST', '/api/playlists/424242/played', undefined),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('says what needs the server, and that a path it has never heard of is not there', async () => {
    const { made } = await signedIn()
    await expect(
      made.cloudRequest('GET', '/api/lyrics/search?q=rain', undefined),
    ).rejects.toMatchObject({ status: 501, code: API_ERROR.needsServer })
    await expect(made.cloudRequest('GET', '/api/nothing', undefined)).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    })
  })
})
