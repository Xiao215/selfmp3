import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The phone's played-song cache, over a fake of the expo-file-system classes it
 * uses. No device here can run it, so what is pinned is everything that can go
 * wrong without anyone noticing: a half-fetched file being played, a copy the
 * system cleared being offered as an address, the oldest copy surviving a full
 * disk, and a song asked for by hand being fetched a second time.
 */

/** Path → size in bytes. */
const disk = new Map<string, number>()
let freeSpace = 100 * 1024 * 1024 * 1024
/** Size of the next download, or null for one that fails. */
let nextDownload: number | null = 4_000_000
const downloads: { url: string; headers: Record<string, string> | undefined }[] = []

class FakeDirectory {
  readonly uri: string
  constructor(parent: string | FakeDirectory, name: string) {
    this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`
  }
  get exists(): boolean {
    return [...disk.keys()].some(path => path.startsWith(`${this.uri}/`)) || disk.has(this.uri)
  }
  create(): void {
    disk.set(this.uri, 0)
  }
  delete(): void {
    for (const path of [...disk.keys()])
      if (path === this.uri || path.startsWith(`${this.uri}/`)) disk.delete(path)
  }
}

class FakeFile {
  readonly uri: string
  constructor(parent: FakeDirectory, name: string) {
    this.uri = `${parent.uri}/${name}`
  }
  get exists(): boolean {
    return disk.has(this.uri)
  }
  get size(): number | null {
    return disk.get(this.uri) ?? null
  }
  delete(): void {
    disk.delete(this.uri)
  }
  move(destination: FakeFile): Promise<void> {
    const bytes = disk.get(this.uri)
    if (bytes === undefined) return Promise.reject(new Error('no such file'))
    disk.delete(this.uri)
    disk.set(destination.uri, bytes)
    return Promise.resolve()
  }
  static createDownloadTask(
    url: string,
    destination: FakeFile,
    options: { headers?: Record<string, string> },
  ): { downloadAsync: () => Promise<{ size: number } | null> } {
    return {
      downloadAsync: () => {
        downloads.push({ url, headers: options.headers })
        if (nextDownload === null) {
          // What a dropped connection leaves behind: some of the file.
          disk.set(destination.uri, 1234)
          return Promise.reject(new Error('connection lost'))
        }
        disk.set(destination.uri, nextDownload)
        return Promise.resolve({ size: nextDownload })
      },
    }
  }
}

vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: {
    cache: 'file:///cache',
    document: 'file:///document',
    get availableDiskSpace() {
      return freeSpace
    },
  },
}))

const stored = new Map<string, string>()
vi.mock('./prefs', () => ({
  prefs: {
    get: (key: string) => stored.get(key) ?? null,
    set: (key: string, value: string) => void stored.set(key, value),
  },
}))
vi.mock('./songSource', () => ({
  sourceFor: (song: { path: string }) =>
    Promise.resolve({
      url: `https://doorman.example/v1/files/${song.path}`,
      headers: { Authorization: 'Bearer t' },
    }),
}))

const HASH = (n: number): string => String(n).repeat(64).slice(0, 64)
const song = (id: number): { id: number; path: string } => ({
  id,
  path: `audio/${HASH(id)}.m4a`,
})
const cached = (id: number): string => `file:///cache/recent-songs/${HASH(id)}.m4a`

async function port(): Promise<typeof import('./recentCopies')> {
  return import('./recentCopies')
}

beforeEach(() => {
  vi.resetModules()
  disk.clear()
  stored.clear()
  downloads.length = 0
  freeSpace = 100 * 1024 * 1024 * 1024
  nextDownload = 4_000_000
  vi.useRealTimers()
})

describe('keeping a song that was played', () => {
  it('fetches it from the bucket with the bearer, and has an address for it after', async () => {
    const recent = await port()
    expect(recent.recentUri(1)).toBeNull()

    await recent.keepRecentlyPlayed(song(1))

    expect(downloads).toEqual([
      {
        url: `https://doorman.example/v1/files/audio/${HASH(1)}.m4a`,
        headers: { Authorization: 'Bearer t' },
      },
    ])
    expect(recent.recentUri(1)).toBe(cached(1))
    expect(recent.recentIds()).toEqual(new Set([1]))
  })

  it('does not fetch a song it already holds', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    await recent.keepRecentlyPlayed(song(1))
    expect(downloads).toHaveLength(1)
  })

  it('fetches once when the same song is kept twice at the same moment', async () => {
    const recent = await port()
    await Promise.all([recent.keepRecentlyPlayed(song(1)), recent.keepRecentlyPlayed(song(1))])
    expect(downloads).toHaveLength(1)
  })

  it('leaves nothing behind, and offers nothing, when the fetch fails part-way', async () => {
    const recent = await port()
    nextDownload = null

    await recent.keepRecentlyPlayed(song(1))

    // Half a file played as a song is silence after the first minute.
    expect(recent.recentUri(1)).toBeNull()
    expect([...disk.keys()].filter(path => path.includes(HASH(1)))).toEqual([])
    expect(recent.recentIds().size).toBe(0)
  })

  it('remembers across a restart', async () => {
    await (await port()).keepRecentlyPlayed(song(1))
    vi.resetModules()
    expect((await port()).recentUri(1)).toBe(cached(1))
  })
})

describe('what the system cleared', () => {
  it('is not offered as an address', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    disk.delete(cached(1))
    // A `file://` with nothing behind it would play as silence in place of a
    // song that could have streamed.
    expect(recent.recentUri(1)).toBeNull()
  })

  it('is fetched again the next time it is played, and dropped from the note meanwhile', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    disk.delete(cached(1))

    await recent.keepRecentlyPlayed(song(2))
    expect(recent.recentIds()).toEqual(new Set([2]))

    await recent.keepRecentlyPlayed(song(1))
    expect(downloads).toHaveLength(3)
    expect(recent.recentUri(1)).toBe(cached(1))
  })
})

describe('making room', () => {
  it('lets the least recently played go first when the disk is nearly full', async () => {
    const recent = await port()
    vi.useFakeTimers()
    // 20 MB that would be free with the cache empty: a 5 MB budget, one song's worth.
    const MB = 1024 * 1024
    nextDownload = 4 * MB

    vi.setSystemTime(1_000)
    freeSpace = 20 * MB
    await recent.keepRecentlyPlayed(song(1))
    vi.setSystemTime(2_000)
    freeSpace = 16 * MB
    await recent.keepRecentlyPlayed(song(2))

    expect(recent.recentIds()).toEqual(new Set([2]))
    expect(disk.has(cached(1))).toBe(false)
    expect(disk.has(cached(2))).toBe(true)
  })

  it('counts a song played again as the newest, so it is the last to go', async () => {
    const recent = await port()
    vi.useFakeTimers()
    const MB = 1024 * 1024
    nextDownload = 4 * MB
    freeSpace = 40 * MB // A 10 MB budget: two songs.

    vi.setSystemTime(1_000)
    await recent.keepRecentlyPlayed(song(1))
    vi.setSystemTime(2_000)
    freeSpace = 36 * MB
    await recent.keepRecentlyPlayed(song(2))
    vi.setSystemTime(3_000)
    await recent.keepRecentlyPlayed(song(1))
    vi.setSystemTime(4_000)
    freeSpace = 32 * MB
    await recent.keepRecentlyPlayed(song(3))

    expect(recent.recentIds()).toEqual(new Set([1, 3]))
  })
})

describe('a song asked for by hand', () => {
  it('is moved into the downloads, not fetched a second time', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    const destination = new FakeFile(
      new FakeDirectory('file:///document', 'songs'),
      `${HASH(1)}.m4a`,
    )

    // The order the app does it in: promoted first, adopted when the transfer runs.
    recent.promoteRecent([1])
    const bytes = await recent.adoptRecent(song(1), destination as never)

    expect(bytes).toBe(4_000_000)
    expect(disk.has(destination.uri)).toBe(true)
    expect(disk.has(cached(1))).toBe(false)
    // A download now, so no longer the budget's to let go of.
    expect(recent.recentIds().size).toBe(0)
    expect(downloads).toHaveLength(1)
  })

  it('has nothing to move for a song never played', async () => {
    const recent = await port()
    const destination = new FakeFile(new FakeDirectory('file:///document', 'songs'), 'x.m4a')
    expect(await recent.adoptRecent(song(9), destination as never)).toBeNull()
  })
})

describe('removing', () => {
  it('deletes the copy of a song removed by hand', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    await recent.keepRecentlyPlayed(song(2))

    recent.forgetRecent([1])

    expect(disk.has(cached(1))).toBe(false)
    expect(recent.recentUri(1)).toBeNull()
    expect(recent.recentUri(2)).toBe(cached(2))
  })

  it('clears every copy with "remove all downloads"', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    await recent.keepRecentlyPlayed(song(2))

    recent.clearRecent()

    expect([...disk.keys()].filter(path => path.includes('recent-songs'))).toEqual([])
    expect(recent.recentIds().size).toBe(0)
  })
})
