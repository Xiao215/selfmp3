import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricsResponse, Motion, PlaylistSongs } from '@selfmp3/shared'

/*
 * The browser's copies of each song's words and motion curve and each
 * playlist's members, over a fake of the IndexedDB port. What is pinned is
 * the regression: clearing them at sign-out once only emptied an in-memory
 * set (the words) or deleted by ids nobody passed (the playlists), and the
 * records stayed — so another account's song 12 opened on the previous
 * account's song 12's words.
 */

const store = new Map<string, unknown>()

vi.mock('../ports/idbStore.web', () => ({
  readStored: async (key: string) => store.get(key) ?? null,
  writeStored: async (key: string, value: unknown) => void store.set(key, value),
  deleteStored: async (key: string) => void store.delete(key),
  deleteStoredPrefix: async (prefix: string) => {
    for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key)
  },
}))

const WORDS: LyricsResponse = {
  source: 'sidecar',
  kind: 'plain',
  text: 'la la la',
  romanized: null,
}
const CURVE: Motion = { version: 1, rate: 20, duration: 1, loudness: 'AAAA', onset: 'AAAA' }
const MEMBERS: PlaylistSongs = { playlistId: 7, songIds: [1, 2, 3] }

/** A record from something else the browser keeps, which sign-out must leave alone. */
const OTHER_KEY = 'library-snapshot'

async function flush(): Promise<void> {
  // The writes are fire-and-forget; the fake resolves them on the next tick.
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  store.clear()
  store.set(OTHER_KEY, { savedAt: 1, library: {} })
  vi.resetModules()
})

describe('the words kept in the browser', () => {
  it('are gone after clearing, and not just forgotten by the page', async () => {
    const cache = await import('./lyricsCache.web')
    cache.writeCachedLyrics(12, WORDS)
    await flush()
    expect(await cache.hasCachedLyrics(12)).toBe(true)

    await cache.clearCachedLyrics()

    expect([...store.keys()].filter(key => key.startsWith('lyrics-'))).toEqual([])
    expect(await cache.hasCachedLyrics(12)).toBe(false)
    expect(await cache.readCachedLyrics(12)).toBeNull()
    expect(store.has(OTHER_KEY)).toBe(true)
  })
})

describe('the motion curves kept in the browser', () => {
  it('are gone after clearing, and not just forgotten by the page', async () => {
    const cache = await import('./motionCache.web')
    cache.writeCachedMotion(12, CURVE)
    await flush()
    expect(await cache.hasCachedMotion(12)).toBe(true)

    await cache.clearCachedMotion()

    expect([...store.keys()].filter(key => key.startsWith('motion-'))).toEqual([])
    expect(await cache.hasCachedMotion(12)).toBe(false)
    expect(await cache.readCachedMotion(12)).toBeNull()
    expect(store.has(OTHER_KEY)).toBe(true)
  })
})

describe('the playlist members kept in the browser', () => {
  it('are all gone after clearing, without being told which playlists there were', async () => {
    const cache = await import('./playlistCache.web')
    cache.writeCachedPlaylist(MEMBERS)
    cache.writeCachedPlaylist({ playlistId: 8, songIds: [4] })
    await flush()
    expect(await cache.readCachedPlaylist(7)).toEqual(MEMBERS)

    await cache.clearCachedPlaylists()

    expect([...store.keys()].filter(key => key.startsWith('playlist-songs-'))).toEqual([])
    expect(await cache.readCachedPlaylist(7)).toBeNull()
    expect(await cache.readCachedPlaylist(8)).toBeNull()
    expect(store.has(OTHER_KEY)).toBe(true)
  })
})
