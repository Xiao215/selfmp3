import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The index the desktop app keeps beside its songs, and what a download keeps
 * beside its file.
 *
 * Regression. Saving it by handing a `blob:` URL to `files.fetchTo` cannot
 * work: that fetch happens in the *main* process, where a renderer's blob URL
 * does not resolve, so every write is refused, `downloads.json` is never
 * written, and a relaunch finds the song files on disk with nothing saying
 * they were downloads. Asserted here: the index goes through `files.write`,
 * and nothing hands the shell a URL it cannot fetch.
 */

let held: { message: string } | null = null

const bridge = {
  onProgress: () => () => undefined,
  files: {
    download: vi.fn(async () => ({ state: 'done' as const, bytes: 1 })),
    write: vi.fn(async () => undefined),
    fetchTo: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  },
  mediaUrl: (kind: string, name: string) => `app://selfmp3/_media/${kind}/${name}`,
}

vi.mock('./bridge', () => ({
  get desktop() {
    return bridge
  },
}))
vi.mock('@selfmp3/replica', () => ({ bucketHold: () => held }))
vi.mock('../bucketRefusal', () => ({ askWhyRefused: async () => null }))
vi.mock('./recentCopies.desktop', () => ({
  desktopRecentCopies: { adoptRecent: async () => null },
}))
vi.mock('../songSource', () => ({
  sourceFor: async () => ({
    url: 'https://doorman.example/v1/files/audio/x.m4a',
    headers: { Authorization: 'Bearer t' },
  }),
}))
const keptLyrics: number[] = []
const keptMotion: number[] = []
vi.mock('../../api/client', () => ({
  api: {
    lyrics: async (songId: number) => ({ songId, lines: [] }),
    motion: async (songId: number) => ({ songId }),
  },
  mediaUrlFor: () => ({ stream: () => '', art: () => '' }),
}))
vi.mock('../../offline/lyricsCache', () => ({
  writeCachedLyrics: (songId: number) => void keptLyrics.push(songId),
}))
vi.mock('../../offline/motionCache', () => ({
  writeCachedMotion: (songId: number) => void keptMotion.push(songId),
}))
vi.mock('../../offline/covers', () => ({
  ensureServerCover: async () => undefined,
  KEPT_COVER_SIZE: 0,
}))
vi.mock('../../replica', () => ({
  cloudPlatform: { doormanUrl: 'https://doorman.example' },
  session: { loadSession: async () => null },
  doormanFileUrl: (key: string) => `https://doorman.example/v1/files/${key}`,
  doormanAuth: (token: string) => ({ Authorization: `Bearer ${token}` }),
}))

const index = {
  version: 1 as const,
  entries: {
    '1': {
      songId: 1,
      fileName: '1.m4a',
      sizeBytes: 4096,
      etag: 'a1b2',
      rev: 'r1',
      downloadedAt: '2026-09-14T00:00:00.000Z',
    },
  },
}

describe('the desktop download index', () => {
  beforeEach(() => {
    bridge.files.write.mockClear()
    bridge.files.fetchTo.mockClear()
    bridge.files.delete.mockReset()
    bridge.files.delete.mockResolvedValue(undefined)
    bridge.files.download.mockClear()
    held = null
    keptLyrics.length = 0
    keptMotion.length = 0
  })

  it('keeps the words and the motion curve with the song, as a phone does', async () => {
    // Left to the catch-up pass, a song downloaded just before the computer
    // went offline had no words on the plane.
    const { downloadStorage } = await import('./downloadStorage.desktop')
    const song = { id: 1, path: 'audio/x.m4a' } as Parameters<typeof downloadStorage.begin>[0]

    await expect(downloadStorage.begin(song, 0, () => undefined).run()).resolves.toBe(1)

    expect(keptLyrics).toEqual([1])
    await vi.waitFor(() => expect(keptMotion).toEqual([1]))
  })

  it('does not ask a bucket refusing for the day for a song', async () => {
    const { downloadStorage } = await import('./downloadStorage.desktop')
    held = { message: 'Your storage is past today’s allowance.' }
    const song = { id: 1, path: 'audio/x.m4a' } as Parameters<typeof downloadStorage.begin>[0]

    await expect(downloadStorage.begin(song, 0, () => undefined).run()).rejects.toThrow(
      'past today’s allowance',
    )
    expect(bridge.files.download).not.toHaveBeenCalled()
  })

  it('waits for the shell to delete a kept file, and passes on its refusal', async () => {
    // Fire-and-forget here meant a file the shell could not remove was
    // forgotten by the index anyway: still on disk, counted nowhere.
    const { downloadStorage } = await import('./downloadStorage.desktop')
    const entry = index.entries['1']
    if (!entry) throw new Error('fixture has no entry')

    await expect(downloadStorage.delete(entry)).resolves.toBeUndefined()
    expect(bridge.files.delete).toHaveBeenCalledWith('songs', '1.m4a')

    bridge.files.delete.mockRejectedValueOnce(new Error('EPERM'))
    await expect(downloadStorage.delete(entry)).rejects.toThrow('EPERM')
  })

  it('is written as text through the shell, not as a URL for it to fetch', async () => {
    const { downloadStorage } = await import('./downloadStorage.desktop')

    await downloadStorage.writeIndex(index)

    expect(bridge.files.fetchTo).not.toHaveBeenCalled()
    expect(bridge.files.write).toHaveBeenCalledTimes(1)
    const [kind, name, text] = bridge.files.write.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ]
    expect(kind).toBe('songs')
    expect(name).toBe('downloads.json')
    expect(JSON.parse(text)).toEqual(index)
  })
})
