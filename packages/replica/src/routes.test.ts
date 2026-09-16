import { describe, expect, it } from 'vitest'
import type { CloudSnapshot } from '@selfmp3/shared'
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
    lyrics: null,
    instrumental: false,
    loved: false,
    playCount: 0,
    skipCount: 0,
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
    songs: [song('a', 'Song a'), song('b', 'Song b')],
    tags: [],
    playlists: [],
  }

  /** Enough of a store and a bucket to read one snapshot through. */
  function device() {
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

    const platform: CloudPlatform = {
      doormanUrl: DOORMAN,
      store,
      fetch: (url: string) => {
        const path = url.slice(DOORMAN.length)
        if (path.startsWith('/v1/list')) {
          const prefix = decodeURIComponent(/prefix=([^&]*)/.exec(path)?.[1] ?? '')
          return reply(200, {
            objects: [...files.keys()]
              .filter(key => key.startsWith(prefix))
              .map(key => ({ key, size: 1 })),
            cursor: null,
          })
        }
        if (path.startsWith('/v1/files/')) {
          const key = path.slice('/v1/files/'.length)
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
    return { session, ...createCloudRoutes(platform, session, library) }
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

  it('needs a session, like every other route that reads the bucket', async () => {
    await expect(device().cloudRequest('GET', '/api/cloud/uids', undefined)).rejects.toMatchObject({
      status: 401,
    })
  })
})
