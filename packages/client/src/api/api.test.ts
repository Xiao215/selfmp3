import { afterEach, describe, expect, it, vi } from 'vitest'
import { BULK_IDS_MAX, LibrarySchema, type Library } from '@selfmp3/shared'
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

  it('sends one request for a small selection', async () => {
    const { api, sent } = recording(() => ({ removed: 2, failed: [] }))

    expect(await api.bulkDeleteSongs({ songIds: [1, 2] })).toEqual({ removed: 2, failed: [] })
    expect(sent).toHaveLength(1)
  })
})
