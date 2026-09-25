import { ApiError } from '@selfmp3/client/core'
import { IDLE_PACING, type ImportJob } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { fixtureLibrary, HELLO_URL, IDOL_URL, memoryStore } from '../../verify/fixtures.js'
import { createHandlers, explain, forPages, Refusal } from './handlers.js'
import { createWatcher } from './watcher.js'

const library = fixtureLibrary()

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** One import that did not make it, for the queue the fake server answers with. */
const failedJob: ImportJob = {
  id: 'job-1',
  url: IDOL_URL,
  status: 'error',
  step: 'downloading',
  progress: null,
  title: 'Idol',
  artist: 'YOASOBI',
  album: '',
  thumbnail: null,
  duration: 213,
  error: 'Video unavailable',
  songId: null,
  attempts: 1,
  tagIds: [],
  createdAt: '2026-09-15 12:00:00',
  updatedAt: '2026-09-15 12:00:30',
}

/** A server in a function: health for anyone, everything else for the token. */
function fakeServer(token: string | null) {
  const calls: string[] = []
  const tags = [...library.tags]
  let version = 1
  const fetchImpl = (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const route = `${init.method ?? 'GET'} ${url.pathname}`
    calls.push(route)
    if (url.hostname === 'asleep.example') return Promise.reject(new TypeError('fetch failed'))
    const headers = (init.headers ?? {}) as Record<string, string>
    const authorised = token === null || headers['Authorization'] === `Bearer ${token}`
    if (route === 'GET /api/health') {
      return Promise.resolve(
        json(200, {
          ok: true,
          version: 'test',
          uptimeSeconds: 1,
          storageDriver: 'local',
          songCount: 2,
        }),
      )
    }
    if (!authorised)
      return Promise.resolve(json(401, { error: 'invalid token', code: 'unauthorized' }))
    switch (route) {
      case 'GET /api/library/version':
        return Promise.resolve(json(200, { version, songCount: library.songs.length }))
      case 'GET /api/library':
        return Promise.resolve(json(200, { ...library, tags }))
      case 'GET /api/settings':
        return Promise.resolve(json(200, { defaultImportTagIds: [1] }))
      case 'GET /api/import/queue':
        return Promise.resolve(
          json(200, { jobs: [failedJob], active: 0, queued: 0, done: 0, pacing: IDLE_PACING }),
        )
      case 'POST /api/import/enqueue': {
        const request = JSON.parse(String(init.body)) as { tagIds: number[] }
        const job = { ...failedJob, id: 'job-2', status: 'queued', step: 'waiting', error: null }
        return Promise.resolve(
          json(200, { jobs: [{ ...job, tagIds: request.tagIds }], skipped: 0, playlistId: null }),
        )
      }
      case 'POST /api/tags': {
        const { name } = JSON.parse(String(init.body)) as { name: string }
        const made = { id: tags.length + 1, name, hue: 200, songCount: 0 }
        tags.push(made)
        version += 1
        return Promise.resolve(json(200, made))
      }
      default:
        return Promise.resolve(json(404, { error: 'not found', code: 'not_found' }))
    }
  }
  return { fetch: fetchImpl as unknown as typeof fetch, calls }
}

describe('connecting', () => {
  it('makes a usable address of what was typed, and keeps its token', async () => {
    const store = memoryStore()
    const handlers = createHandlers({ store, fetch: fakeServer('secret').fetch })
    const status = await handlers.connect({
      type: 'connect',
      baseUrl: 'localhost:4600',
      token: ' secret ',
    })
    expect(status).toEqual({
      mode: 'server',
      server: { baseUrl: 'http://localhost:4600', typed: true },
      account: null,
      songCount: 2,
    })
    expect(await store.read('server')).toEqual({
      baseUrl: 'http://localhost:4600',
      token: 'secret',
    })
  })

  it('refuses a bad address, a server that is not there and a wrong token, and keeps nothing', async () => {
    const store = memoryStore()
    const handlers = createHandlers({ store, fetch: fakeServer('secret').fetch })
    const connect = (baseUrl: string, token: string | null) =>
      handlers.connect({ type: 'connect', baseUrl, token })

    await expect(connect('not an address', null)).rejects.toMatchObject({ status: 400 })
    await expect(connect('https://asleep.example', null)).rejects.toMatchObject({ status: 0 })
    await expect(connect('http://localhost:4600', 'wrong')).rejects.toMatchObject({
      status: 401,
      message: 'The server refused that token.',
    })
    await expect(connect('http://localhost:4600', null)).rejects.toMatchObject({
      status: 401,
      message: 'That server needs its token.',
    })
    expect(await store.read('server')).toBeNull()
  })

  it('says a stored server is away when it does not answer, and there is no bucket behind it', async () => {
    const store = memoryStore()
    await store.write('server', { baseUrl: 'https://asleep.example', token: null })
    const handlers = createHandlers({ store, fetch: fakeServer(null).fetch })
    expect(await handlers.status({ type: 'status' })).toEqual({
      mode: 'away',
      server: { baseUrl: 'https://asleep.example', typed: true },
      account: null,
      songCount: null,
    })
  })

  it('has nowhere to import to with neither an address nor an account', async () => {
    const handlers = createHandlers({ store: memoryStore(), fetch: fakeServer(null).fetch })
    expect(await handlers.status({ type: 'status' })).toEqual({
      mode: 'none',
      server: null,
      account: null,
      songCount: null,
    })
    await expect(handlers.signIn({ type: 'signIn' })).rejects.toBeInstanceOf(Refusal)
  })
})

describe('asking about a link', () => {
  async function connected() {
    const store = memoryStore()
    const server = fakeServer(null)
    const handlers = createHandlers({ store, fetch: server.fetch })
    await handlers.connect({ type: 'connect', baseUrl: 'http://localhost:4600', token: null })
    return { handlers, calls: server.calls }
  }

  it('finds a song already imported by its video, reading the library once', async () => {
    const { handlers, calls } = await connected()
    expect(
      await handlers.songFor({ type: 'songFor', url: 'https://youtu.be/YQHsXMglC9A' }),
    ).toMatchObject({
      title: 'Hello',
      playCount: 41,
    })
    expect(await handlers.songFor({ type: 'songFor', url: HELLO_URL })).toMatchObject({ id: 1 })
    expect(await handlers.songFor({ type: 'songFor', url: IDOL_URL })).toBeNull()
    expect(await handlers.songFor({ type: 'songFor', url: 'https://example.com/' })).toBeNull()
    expect(calls.filter(call => call === 'GET /api/library')).toHaveLength(1)
  })

  it('offers the tags, and the ones every import gets — never a playlist', async () => {
    const { handlers } = await connected()
    const choices = await handlers.choices({ type: 'choices' })
    expect(choices.tags.map(tag => tag.name)).toEqual(['new', 'j-pop'])
    expect(choices.defaultTagIds).toEqual([1])
    expect(choices).not.toHaveProperty('playlists')
  })

  it('remembers the tags an import went in with, and offers them for the next', async () => {
    const { handlers } = await connected()
    expect((await handlers.choices({ type: 'choices' })).lastTagIds).toEqual([])
    await handlers.enqueue({
      type: 'enqueue',
      request: {
        items: [
          {
            url: IDOL_URL,
            title: 'Idol',
            artist: 'YOASOBI',
            album: '',
            thumbnail: null,
            duration: 213,
          },
        ],
        tagIds: [2, 99],
        playlistId: null,
        createPlaylistName: null,
      },
      label: null,
    })
    // A tag the library no longer has (99) is not offered back.
    expect((await handlers.choices({ type: 'choices' })).lastTagIds).toEqual([2])
  })

  it('makes a new tag, and offers it the next time the tags are asked for', async () => {
    const { handlers } = await connected()
    await handlers.choices({ type: 'choices' })
    const made = await handlers.createTag({ type: 'createTag', name: 'city pop' })
    expect(made).toMatchObject({ id: 3, name: 'city pop' })
    const choices = await handlers.choices({ type: 'choices' })
    expect(choices.tags.map(tag => tag.name)).toEqual(['new', 'j-pop', 'city pop'])
  })

  it('asks for a server before it looks anything up', async () => {
    const handlers = createHandlers({ store: memoryStore(), fetch: fakeServer(null).fetch })
    await expect(handlers.preview({ type: 'preview', url: IDOL_URL })).rejects.toBeInstanceOf(
      Refusal,
    )
  })
})

describe('the queue', () => {
  it('clears the badge’s ! when a page asks, and not when the watcher does', async () => {
    const store = memoryStore()
    const badges: string[] = []
    // Wired as index.ts wires them: the watcher reads the queue through the
    // handlers it is a dependency of.
    const watcher = createWatcher({
      store,
      queue: () => handlers.queue({ type: 'queue' }),
      badge: text => {
        badges.push(text)
      },
      notify: () => undefined,
    })
    const handlers = createHandlers({ store, fetch: fakeServer(null).fetch, watcher })
    await handlers.connect({ type: 'connect', baseUrl: 'http://localhost:4600', token: null })

    await watcher.add([{ ...failedJob, status: 'running' }], null)
    await watcher.tick()
    expect(badges.at(-1)).toBe('!')
    await watcher.tick()
    expect(badges.at(-1)).toBe('!')

    // The pill's channel reads the queue the plain way too.
    await handlers.queue({ type: 'queue' })
    expect(badges.at(-1)).toBe('!')

    await forPages(handlers, watcher).queue({ type: 'queue' })
    expect(badges.at(-1)).toBe('')
  })
})

describe('explain', () => {
  it('puts every failure in words a page can show', () => {
    expect(explain(new ApiError(0, 'fetch failed', 'offline'))).toEqual({
      message: 'Your server isn’t answering.',
      status: 0,
    })
    expect(explain(new ApiError(401, 'invalid token'))).toMatchObject({ status: 401 })
    expect(explain(new ApiError(422, 'This video is private.'))).toEqual({
      message: 'This video is private.',
      status: 422,
    })
    expect(explain(new Refusal('Connect first.', 428))).toEqual({
      message: 'Connect first.',
      status: 428,
    })
    expect(explain('odd')).toEqual({ message: 'Something went wrong.', status: 500 })
  })
})
