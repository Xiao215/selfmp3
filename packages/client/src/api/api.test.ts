import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibrarySchema, type Library } from '@selfmp3/shared'
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
