import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The index the desktop app keeps beside its songs.
 *
 * Regression. It used to be saved by handing a `blob:` URL to `files.fetchTo`,
 * and the fetch behind that call happens in the *main* process, where a
 * renderer's blob URL does not resolve at all — so every write was refused,
 * `downloads.json` was never written, and a relaunch found the song files on
 * disk with nothing saying they were downloads. What is asserted here is that
 * the index goes through `files.write`, and that nothing hands the shell a URL
 * it cannot fetch.
 */

const bridge = {
  files: {
    write: vi.fn(async () => undefined),
    fetchTo: vi.fn(async () => undefined),
  },
  mediaUrl: (kind: string, name: string) => `app://selfmp3/_media/${kind}/${name}`,
}

vi.mock('./bridge', () => ({ get desktop() { return bridge } }))
vi.mock('../../api/client', () => ({ mediaUrlFor: () => ({ stream: () => '' }) }))
vi.mock('../../cloud', () => ({
  cloudPlatform: { doormanUrl: 'https://doorman.example' },
  session: { loadSession: async () => null },
}))

const index = {
  version: 1 as const,
  entries: {
    '1': {
      songId: 1,
      fileName: '1.m4a',
      sizeBytes: 4096,
      etag: 'a1b2',
      downloadedAt: '2026-09-14T00:00:00.000Z',
    },
  },
}

describe('the desktop download index', () => {
  beforeEach(() => {
    bridge.files.write.mockClear()
    bridge.files.fetchTo.mockClear()
  })

  it('is written as text through the shell, not as a URL for it to fetch', async () => {
    const { downloadStorage } = await import('./downloadStorage.desktop')

    await downloadStorage.writeIndex(index)

    expect(bridge.files.fetchTo).not.toHaveBeenCalled()
    expect(bridge.files.write).toHaveBeenCalledTimes(1)
    const [kind, name, text] = bridge.files.write.mock.calls[0] as unknown as [string, string, string]
    expect(kind).toBe('songs')
    expect(name).toBe('downloads.json')
    expect(JSON.parse(text)).toEqual(index)
  })
})
