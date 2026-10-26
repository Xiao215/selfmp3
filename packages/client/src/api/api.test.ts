import { afterEach, describe, expect, it, vi } from 'vitest'
import { BULK_IDS_MAX, LYRICS_QUERY_MAX, LibrarySchema, type Library } from '@selfmp3/shared'
import { TIMED_OUT } from '../connection/reach.js'
import { createApi } from './api.js'

/**
 * Answers from this device's copy of a cloud library. The replica hands back
 * the same library object until something changes, and checking a library of
 * thousands of songs against the schema on every refetch was most of what a
 * refetch with nothing new cost on a phone.
 */

const library = (version: number): Library => ({
  songs: [],
  tags: [],
  playlists: [],
  artistNames: {},
  spellings: {},
  version,
  generatedAt: '2026-09-14T10:00:00.000Z',
})

function cloudApi(answer: () => unknown) {
  return createApi({
    context: () => ({
      transport: null,
      fromCloud: true,
      cloudRequest: () => Promise.resolve(answer()),
    }),
    fetch: () => Promise.reject(new Error('no server in a cloud library')),
  })
}

describe('answers from a cloud library', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('checks the same library once, and a new one again', async () => {
    const check = vi.spyOn(LibrarySchema, 'safeParse')
    let current = library(1)
    const api = cloudApi(() => current)

    const first = await api.library()
    const again = await api.library()
    expect(again).toBe(first)
    expect(check).toHaveBeenCalledTimes(1)

    current = library(2)
    expect((await api.library()).version).toBe(2)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('still refuses an answer that does not fit', async () => {
    const api = cloudApi(() => ({ songs: 'not a list' }))

    await expect(api.library()).rejects.toMatchObject({ code: 'contract_mismatch' })
  })
})

/**
 * Select-all over a big library: every bulk route takes at most
 * `BULK_IDS_MAX` songs, and a selection of 2,109 failed whole with a 400.
 */
describe('a bulk edit bigger than one request may be', () => {
  const ids = Array.from({ length: 4500 }, (_, i) => i + 1)

  function recording(answer: (path: string, body: { songIds: number[] }) => unknown) {
    const sent: { path: string; body: { songIds: number[]; position?: number } }[] = []
    const api = createApi({
      context: () => ({
        transport: null,
        fromCloud: true,
        cloudRequest: (_method, path, body) => {
          const sentBody = body as { songIds: number[]; position?: number }
          sent.push({ path, body: sentBody })
          return Promise.resolve(answer(path, sentBody))
        },
      }),
      fetch: () => Promise.reject(new Error('no server in a cloud library')),
    })
    return { api, sent }
  }

  it('goes in parts of at most BULK_IDS_MAX, every song once, and adds up what they did', async () => {
    const { api, sent } = recording((_, body) => ({ affected: body.songIds.length }))

    expect(await api.bulkTag({ tagId: 1, songIds: ids, action: 'add' })).toEqual({
      affected: 4500,
    })
    expect(sent.map(part => part.body.songIds.length)).toEqual([BULK_IDS_MAX, BULK_IDS_MAX, 500])
    expect(sent.flatMap(part => part.body.songIds)).toEqual(ids)
  })

  it('puts the parts of a selection into a playlist one after another', async () => {
    const playlist = {
      id: 3,
      name: 'Mix',
      description: '',
      songCount: 0,
      totalDuration: 0,
      pinned: false,
      kind: 'manual',
      rules: null,
      createdAt: '2026-09-14 10:00:00',
      updatedAt: '2026-09-14 10:00:00',
      lastPlayedAt: null,
    }
    const { api, sent } = recording(() => playlist)

    await api.addToPlaylist(3, { songIds: ids, position: 7 })
    expect(sent.map(part => part.body.position)).toEqual([
      7,
      7 + BULK_IDS_MAX,
      7 + 2 * BULK_IDS_MAX,
    ])
  })

  it('makes a playlist of a big selection with its first part, then adds the rest', async () => {
    const playlist = {
      id: 9,
      name: 'Up next',
      description: '',
      songCount: 0,
      totalDuration: 0,
      pinned: false,
      kind: 'manual',
      rules: null,
      createdAt: '2026-09-14 10:00:00',
      updatedAt: '2026-09-14 10:00:00',
      lastPlayedAt: null,
    }
    const { api, sent } = recording(() => playlist)

    await api.createPlaylist({
      name: 'Up next',
      description: '',
      kind: 'manual',
      rules: null,
      songIds: ids,
    })
    expect(sent.map(part => [part.path, part.body.songIds.length])).toEqual([
      ['/api/playlists', BULK_IDS_MAX],
      ['/api/playlists/9/songs', BULK_IDS_MAX],
      ['/api/playlists/9/songs', 500],
    ])
    expect(sent.flatMap(part => part.body.songIds)).toEqual(ids)
  })

  it('sends one request for a small selection', async () => {
    const { api, sent } = recording(() => ({ removed: 2, failed: [] }))

    expect(await api.bulkDeleteSongs({ songIds: [1, 2] })).toEqual({ removed: 2, failed: [] })
    expect(sent).toHaveLength(1)
  })
})

describe('lyric search', () => {
  it('asks with the start of a search longer than the server reads', async () => {
    const paths: string[] = []
    const api = createApi({
      context: () => ({
        transport: null,
        fromCloud: true,
        cloudRequest: (_method, path) => {
          paths.push(path)
          return Promise.resolve({ hits: [] })
        },
      }),
      fetch: () => Promise.reject(new Error('no server in a cloud library')),
    })

    await api.lyricsSearch('阿'.repeat(5000))

    const q = new URL(paths[0] ?? '', 'http://x').searchParams.get('q') ?? ''
    expect(q).toBe('阿'.repeat(LYRICS_QUERY_MAX))
  })
})

/**
 * A server busy with a scan applied every part of a 5,040-song tag, but
 * answered one after the deadline, and the app said it had failed (R3-m9).
 */
describe('a bulk edit whose answer runs out of time', () => {
  const ids = Array.from({ length: 5040 }, (_, i) => i + 1)

  function server(fail: (call: number) => Error | null) {
    const sent: number[][] = []
    const api = createApi({
      context: () => ({
        transport: { url: path => `http://server.test${path}` },
        fromCloud: false,
      }),
      fetch: (_url, init) => {
        const body = JSON.parse(init?.body ?? '{}') as { songIds: number[] }
        sent.push(body.songIds)
        const failure = fail(sent.length)
        if (failure) return Promise.reject(failure)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ affected: body.songIds.length }),
        } as unknown as Response)
      },
    })
    return { api, sent }
  }

  it('asks again for a part that ran out of time, rather than calling the whole edit failed', async () => {
    const { api, sent } = server(call => (call === 2 ? new Error(TIMED_OUT) : null))

    await expect(api.bulkTag({ tagId: 1, songIds: ids, action: 'add' })).resolves.toBeTruthy()
    expect(sent.map(part => part.length)).toEqual([BULK_IDS_MAX, BULK_IDS_MAX, BULK_IDS_MAX, 1040])
    expect(sent[2]).toEqual(sent[1])
  })

  it('gives up on a part that keeps running out of time', async () => {
    const { api, sent } = server(call => (call >= 2 ? new Error(TIMED_OUT) : null))

    await expect(api.bulkLoved({ loved: true, songIds: ids })).rejects.toMatchObject({
      status: 0,
      message: TIMED_OUT,
    })
    expect(sent).toHaveLength(4)
  })

  it('fails at once when the server is not there at all', async () => {
    const { api, sent } = server(() => new TypeError('Failed to fetch'))

    await expect(api.bulkTag({ tagId: 1, songIds: ids, action: 'add' })).rejects.toMatchObject({
      status: 0,
    })
    expect(sent).toHaveLength(1)
  })
})
