import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The browser's download storage, over a fake of the audio cache it writes to.
 *
 * One thing pinned: `delete` is the cache's promise, not a fire-and-forget. It
 * used to swallow the rejection, so a copy the cache would not give up was
 * dropped from the index anyway — still taking space, counted nowhere, and
 * with nothing left that could ask for it to go again.
 */

const cache = {
  uncacheSong: vi.fn<(songId: number) => Promise<void>>(),
  present: new Set<number>(),
  recent: new Set<number>(),
  savedIndex: null as string | null,
}

vi.mock('./offline.web', () => ({
  cachedSongIds: async () => cache.present,
  cacheSong: async () => 0,
  clearAudioCache: async () => undefined,
  configureAudioCache: () => undefined,
  offlineStorageAvailable: () => true,
  uncacheSong: (songId: number) => cache.uncacheSong(songId),
}))
// No shell: the tab's cache is the storage, not the desktop's files.
vi.mock('./desktop/bridge', () => ({ desktop: null }))
vi.mock('./desktop/downloadStorage.desktop', () => ({ downloadStorage: {} }))
vi.mock('../api/client', () => ({
  answeringFromCloud: () => false,
  mediaUrlFor: () => ({ stream: () => '' }),
}))
vi.mock('../api/mediaAddress.model', () => ({
  serverRoutes: () => null,
  streamAddress: () => '',
}))
vi.mock('./bucketMedia', () => ({ bucketMedia: null }))
vi.mock('./recentCopies', () => ({ recentIds: () => cache.recent }))
// Same reason: the port's native half reaches for expo-file-system, which no
// browser and no test runner has. The browser's half is localStorage.
vi.mock('./prefs', () => ({ prefs: { get: () => cache.savedIndex, set: () => undefined } }))

const entry = {
  songId: 7,
  fileName: '7',
  sizeBytes: 4096,
  etag: '',
  rev: 'r7',
  downloadedAt: '2026-09-14T00:00:00.000Z',
}

describe('the browser download storage', () => {
  beforeEach(() => {
    cache.uncacheSong.mockReset()
    cache.uncacheSong.mockResolvedValue(undefined)
    cache.present = new Set()
    cache.recent = new Set()
    cache.savedIndex = null
  })

  it('lists the saved downloads it holds, keeps recent copies, and lets the rest go', async () => {
    const { downloadStorage } = await import('./downloadStorage.web')
    cache.present = new Set([7, 8, 9])
    cache.recent = new Set([9])
    cache.savedIndex = JSON.stringify({ version: 1, entries: { '7': entry } })

    const index = await downloadStorage.readIndex()

    expect(Object.keys(index?.entries ?? {})).toEqual(['7'])
    // 8 is in the cache with nothing saved about it; 9 is a recently played copy.
    expect(cache.uncacheSong.mock.calls).toEqual([[8]])
  })

  it('waits for the cache to give a kept song up, and passes on its refusal', async () => {
    const { downloadStorage } = await import('./downloadStorage.web')

    await expect(downloadStorage.delete(entry)).resolves.toBeUndefined()
    expect(cache.uncacheSong).toHaveBeenCalledWith(7)

    cache.uncacheSong.mockRejectedValueOnce(new Error('QuotaExceededError'))
    await expect(downloadStorage.delete(entry)).rejects.toThrow('QuotaExceededError')
  })
})
