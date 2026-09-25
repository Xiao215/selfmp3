import type { ImportRequestView } from '@selfmp3/replica'
import type { ImportJob } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import type { Handlers } from '../bridge.js'
import { createPageHandler, stateOfJob, stateOfRequest } from './pill.js'

const IDOL = 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ'

const job = (patch: Partial<ImportJob> = {}): ImportJob => ({
  id: 'j1',
  url: 'https://music.youtube.com/watch?v=ZRtdQ81jPUQ',
  status: 'running',
  step: 'downloading',
  progress: 40,
  title: 'アイドル',
  artist: 'YOASOBI',
  album: '',
  thumbnail: null,
  duration: 213,
  error: null,
  songId: null,
  attempts: 0,
  tagIds: [],
  createdAt: '2026-09-15 12:00:00',
  updatedAt: '2026-09-15 12:00:30',
  ...patch,
})

const item = {
  url: IDOL,
  title: 'アイドル',
  artist: 'YOASOBI',
  album: '',
  duration: 213,
  thumbnail: null,
  alreadyHave: false,
  waitingToUpload: false,
  inQueue: false,
}

const request = (patch: Partial<ImportRequestView> = {}): ImportRequestView => ({
  uid: 'r1',
  url: 'https://music.youtube.com/watch?v=ZRtdQ81jPUQ',
  state: 'waiting',
  title: null,
  songIds: [],
  error: null,
  requestedAt: '2026-09-16 12:00:00',
  requestedBy: 'extension',
  ...patch,
})

const status = (mode: 'server' | 'bucket') => () =>
  Promise.resolve({ mode, server: null, account: null, songCount: null })

function fakeHandlers(patch: Partial<Record<keyof Handlers, unknown>>): {
  handlers: Handlers
  enqueued: unknown[]
} {
  const enqueued: unknown[] = []
  const handlers = {
    status: status('server'),
    choices: () => Promise.resolve({ tags: [], defaultTagIds: [], lastTagIds: [7] }),
    requests: () => Promise.resolve({ imports: [] }),
    queue: () => Promise.resolve({ jobs: [], active: 0, queued: 0 }),
    songFor: () => Promise.resolve(null),
    preview: () => Promise.resolve({ kind: 'single', playlistTitle: null, items: [item] }),
    enqueue: (request: unknown) => {
      enqueued.push(request)
      return Promise.resolve({
        jobs: [job({ status: 'queued', step: 'waiting', progress: null })],
        skipped: 0,
        playlistId: null,
      })
    },
    ...patch,
  } as unknown as Handlers
  return { handlers, enqueued }
}

describe('stateOfJob', () => {
  it('turns a job into what the pill draws', () => {
    expect(stateOfJob(job())).toEqual({
      state: 'importing',
      progress: 40,
      jobId: 'j1',
      message: null,
    })
    expect(stateOfJob(job({ step: 'lyrics', progress: null })).progress).toBeNull()
    expect(stateOfJob(job({ status: 'queued', step: 'waiting', progress: null }))).toEqual({
      state: 'queued',
      progress: null,
      jobId: 'j1',
      message: null,
    })
    expect(stateOfJob(job({ status: 'done', step: 'finished' })).state).toBe('added')
    expect(stateOfJob(job({ status: 'error', error: 'Video unavailable' }))).toMatchObject({
      state: 'failed',
      message: 'Video unavailable',
    })
    expect(stateOfJob(job({ status: 'cancelled' })).state).toBe('idle')
  })
})

describe('stateOfRequest', () => {
  it('turns a link left in the bucket into what the pill draws', () => {
    expect(stateOfRequest(request())).toEqual({
      state: 'waiting',
      progress: null,
      jobId: null,
      message: null,
    })
    // Working is still waiting from here: the server says how it went in its
    // next snapshot, and there is no percentage to follow in between.
    expect(stateOfRequest(request({ state: 'working' })).state).toBe('waiting')
    expect(stateOfRequest(request({ state: 'done', songIds: [7] })).state).toBe('added')
    expect(stateOfRequest(request({ state: 'failed', error: 'Video unavailable' }))).toMatchObject({
      state: 'failed',
      message: 'Video unavailable',
    })
    expect(stateOfRequest(request({ state: 'cancelled' })).state).toBe('idle')
  })
})

describe('what a page may ask', () => {
  it('says nothing at all about a link that is not a video', async () => {
    const { handlers } = fakeHandlers({})
    const handle = createPageHandler(handlers)
    expect(await handle({ type: 'pillState', url: 'https://example.com/' })).toMatchObject({
      state: 'idle',
    })
  })

  it('says a song is already yours', async () => {
    const { handlers } = fakeHandlers({
      songFor: () =>
        Promise.resolve({
          id: 1,
          title: 'アイドル',
          artist: 'YOASOBI',
          addedAt: '2026-08-12 10:00:00',
          playCount: 41,
        }),
    })
    expect(await createPageHandler(handlers)({ type: 'pillState', url: IDOL })).toMatchObject({
      state: 'have',
    })
  })

  it('finds the job for that video, whichever link queued it', async () => {
    const { handlers } = fakeHandlers({
      queue: () => Promise.resolve({ jobs: [job()], active: 1, queued: 0 }),
    })
    expect(await createPageHandler(handlers)({ type: 'pillState', url: IDOL })).toMatchObject({
      state: 'importing',
      progress: 40,
    })
  })

  it('imports with the tags the last import went in with, and tells the page nothing about your library', async () => {
    const { handlers, enqueued } = fakeHandlers({})
    const state = await createPageHandler(handlers)({ type: 'pillImport', url: IDOL })
    expect(state).toMatchObject({ state: 'queued' })
    // The last import's tags and no playlist: the page chooses nothing, and
    // the server adds the default tags itself.
    expect(enqueued).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          tagIds: [7],
          playlistId: null,
          createPlaylistName: null,
        }),
        label: null,
      }),
    ])
    expect(JSON.stringify(state)).not.toContain('YOASOBI - Topic')
  })

  it('does not import a song that is already there', async () => {
    const { handlers, enqueued } = fakeHandlers({
      preview: () =>
        Promise.resolve({
          kind: 'single',
          playlistTitle: null,
          items: [{ ...item, alreadyHave: true }],
        }),
    })
    expect(await createPageHandler(handlers)({ type: 'pillImport', url: IDOL })).toMatchObject({
      state: 'have',
    })
    expect(enqueued).toHaveLength(0)
  })

  it('finds the link already left in the bucket, whichever form it was left under', async () => {
    const { handlers } = fakeHandlers({
      status: status('bucket'),
      requests: () => Promise.resolve({ imports: [request()] }),
    })
    expect(await createPageHandler(handlers)({ type: 'pillState', url: IDOL })).toMatchObject({
      state: 'waiting',
    })
  })

  /*
   * Through the bucket nothing reads the link first, because only the server
   * can: the link goes in as it is, and the popup says so in its own words.
   */
  it('leaves the link in the bucket when the server is away, without a preview', async () => {
    const left: unknown[] = []
    const { handlers, enqueued } = fakeHandlers({
      status: status('bucket'),
      preview: () => Promise.reject(new Error('the server should never be asked')),
      requestImport: (input: unknown) => {
        left.push(input)
        return Promise.resolve(request())
      },
    })
    expect(await createPageHandler(handlers)({ type: 'pillImport', url: IDOL })).toMatchObject({
      state: 'waiting',
    })
    expect(left).toEqual([{ type: 'requestImport', url: IDOL, tagIds: [7] }])
    expect(enqueued).toHaveLength(0)
  })
})
