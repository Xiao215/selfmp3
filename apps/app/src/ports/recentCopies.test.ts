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
  list(): { name: string }[] {
    return [...disk.keys()]
      .filter(path => path.startsWith(`${this.uri}/`))
      .map(path => ({ name: path.slice(this.uri.length + 1) }))
  }
}

class FakeFile {
  readonly uri: string
  readonly name: string
  constructor(parent: FakeDirectory, name: string) {
    this.uri = `${parent.uri}/${name}`
    this.name = name
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

/**
 * The loopback server (`songStream.ts`), as far as this file sees it: an
 * address for a song, one download of it from the doorman however often it is
 * asked for, and word when it is all here. Left to itself a fetch lands at
 * once (or fails, with `nextDownload` null); `held` keeps every download
 * arriving until the test says it is all here (`arrive`).
 */
class FakeStream {
  /** Every download asked of the doorman, by its address. */
  readonly upstream: string[] = []
  stopped = 0
  readonly #held: boolean
  readonly #waiting = new Map<string, ((bytes: number | null) => void)[]>()
  readonly #listeners: ((arrived: { name: string; bytes: number }) => void)[] = []

  constructor({ held = false }: { held?: boolean } = {}) {
    this.#held = held
  }

  address(name: string, _url: string, _headers: unknown, _directory: string): string {
    return `http://127.0.0.1:5555/${name}`
  }

  /** The player asking for the first range: answered from the folder, or the one download starts. */
  play(name: string, url: string): void {
    if (this.#waiting.has(name) || disk.has(`file:///cache/recent-songs/${name}`)) return
    this.upstream.push(url)
    this.#waiting.set(name, [])
  }

  fetch(
    name: string,
    url: string,
    headers: Record<string, string>,
    directory: string,
  ): Promise<number | null> {
    const whole = disk.get(`${directory}/${name}`)
    if (whole !== undefined) return Promise.resolve(whole)
    if (!this.#held && !this.#waiting.has(name)) {
      downloads.push({ url, headers })
      // A dropped connection: the server deletes what part of the file came.
      if (nextDownload === null) return Promise.resolve(null)
      const bytes = nextDownload
      this.arrive(name, bytes)
      return Promise.resolve(bytes)
    }
    this.play(name, url)
    return new Promise(resolve => this.#waiting.get(name)?.push(resolve))
  }

  /** All here: renamed into the folder, the fetches waiting on it answered, and JavaScript told. */
  arrive(name: string, bytes: number): void {
    disk.set(`file:///cache/recent-songs/${name}`, bytes)
    for (const resolve of this.#waiting.get(name) ?? []) resolve(bytes)
    this.#waiting.delete(name)
    for (const listener of this.#listeners) listener({ name, bytes })
  }

  /** Downloads stopped one by one, by name. */
  readonly cancelled: string[] = []

  /** Stopped: what came of it deleted, and whoever waits on it told it did not arrive. */
  cancel(name: string): void {
    this.cancelled.push(name)
    for (const resolve of this.#waiting.get(name) ?? []) resolve(null)
    this.#waiting.delete(name)
  }

  stopAll(): void {
    this.stopped += 1
  }

  addListener(
    _event: 'onArrived',
    listener: (arrived: { name: string; bytes: number }) => void,
  ): { remove(): void } {
    this.#listeners.push(listener)
    return { remove: () => undefined }
  }
}

let native = new FakeStream()
vi.mock('expo', () => ({
  requireNativeModule: (name: string) => (name === 'SongStream' ? native : null),
}))

const HASH = (n: number): string => String(n).repeat(64).slice(0, 64)
const song = (id: number): { id: number; path: string } => ({
  id,
  path: `audio/${HASH(id)}.m4a`,
})
const cached = (id: number): string => `file:///cache/recent-songs/${HASH(id)}.m4a`
/** The same song after its audio was replaced: a new hash, so a new name. */
const replaced = (id: number): { id: number; path: string } => ({
  id,
  path: `audio/${'f'.repeat(64)}.m4a`,
})
const replacedCopy = `file:///cache/recent-songs/${'f'.repeat(64)}.m4a`

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
  native = new FakeStream()
  vi.useRealTimers()
})

describe('a song streamed through the loopback server', () => {
  const doorman = (id: number): string => `https://doorman.example/v1/files/audio/${HASH(id)}.m4a`
  const name = (id: number): string => `${HASH(id)}.m4a`

  it('is kept the moment its one download is whole, and is not fetched again for counting', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()

    expect(recent.streamOnce(song(1), doorman(1), { Authorization: 'Bearer t' })).toBe(
      `http://127.0.0.1:5555/${name(1)}`,
    )
    stream.play(name(1), doorman(1))
    stream.arrive(name(1), 4_000_000)
    await vi.waitFor(() => expect(recent.recentUri(song(1))).toBe(cached(1)))

    await recent.keepRecentlyPlayed(song(1))

    expect(stream.upstream).toEqual([doorman(1)])
    expect(downloads).toHaveLength(0)
  })

  it('joins the download under way when the play counts before it is whole', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    recent.streamOnce(song(1), doorman(1), { Authorization: 'Bearer t' })
    stream.play(name(1), doorman(1))

    const keeping = recent.keepRecentlyPlayed(song(1))
    await Promise.resolve()
    stream.arrive(name(1), 4_000_000)
    await keeping

    expect(stream.upstream).toEqual([doorman(1)])
    expect(downloads).toHaveLength(0)
    expect(recent.recentUri(song(1))).toBe(cached(1))
  })

  it('fetches the next song ahead through the same server, so playing it asks nothing more', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()

    const ahead = recent.keepRecentlyPlayed(song(2))
    await vi.waitFor(() => expect(stream.upstream).toHaveLength(1))
    stream.arrive(name(2), 3_000_000)
    await ahead
    stream.play(name(2), doorman(2))

    expect(stream.upstream).toEqual([doorman(2)])
    expect(recent.recentUri(song(2))).toBe(cached(2))
  })

  it('leaves a file not named by its hash to the doorman', async () => {
    const recent = await port()
    expect(recent.streamOnce({ id: 3, path: 'audio/three.m4a' }, 'https://d/x', {})).toBeNull()
  })

  it('stops what is arriving when every copy is cleared', async () => {
    const stream = native
    const recent = await port()
    recent.clearRecent()
    expect(stream.stopped).toBe(1)
  })

  it('keeps a song as played when it was asked for, not when it landed', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    vi.useFakeTimers()
    // Two songs' worth of free space and held copies make a one-song budget.
    const MB = 1024 * 1024
    freeSpace = 20 * MB

    vi.setSystemTime(1_000)
    recent.streamOnce(song(1), doorman(1), {})
    stream.play(name(1), doorman(1))
    vi.setSystemTime(2_000)
    recent.streamOnce(song(2), doorman(2), {})
    stream.play(name(2), doorman(2))
    vi.setSystemTime(3_000)
    stream.arrive(name(2), 4 * MB)
    await vi.waitFor(() => expect(recent.recentIds()).toEqual(new Set([2])))
    // The song asked for first lands last: still the older of the two.
    vi.setSystemTime(4_000)
    freeSpace = 16 * MB
    stream.arrive(name(1), 4 * MB)

    await vi.waitFor(() => expect(disk.has(cached(1))).toBe(false))
    expect(recent.recentIds()).toEqual(new Set([2]))
  })

  it('keeps both of two songs that land together', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    recent.streamOnce(song(1), doorman(1), {})
    recent.streamOnce(song(2), doorman(2), {})
    stream.play(name(1), doorman(1))
    stream.play(name(2), doorman(2))

    // The second written down while the first's trim is asking the folder.
    stream.arrive(name(1), 4_000_000)
    stream.arrive(name(2), 4_000_000)

    await vi.waitFor(() => expect(recent.recentIds()).toEqual(new Set([1, 2])))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recent.recentIds()).toEqual(new Set([1, 2]))
  })

  it('does not keep a song removed by hand while it arrived', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    recent.streamOnce(song(1), doorman(1), {})
    stream.play(name(1), doorman(1))

    recent.forgetRecent([1])
    stream.arrive(name(1), 4_000_000)

    await vi.waitFor(() => expect(disk.has(cached(1))).toBe(false))
    expect(recent.recentIds().size).toBe(0)
  })

  // Bug bash R2-m15: an Ogg the phone cannot play was fetched whole and kept.
  it('stops the download of a song forgotten while it arrives', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    recent.streamOnce(song(1), doorman(1), {})
    stream.play(name(1), doorman(1))

    recent.forgetRecent([1])

    expect(stream.cancelled).toEqual([name(1)])
  })

  // Bug bash R2-m24: the song after the old one went on arriving once another was picked.
  it('stops fetching the song ahead once it is no longer coming, and keeps nothing of it', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    const ahead = recent.keepRecentlyPlayed(song(2))
    await vi.waitFor(() => expect(stream.upstream).toHaveLength(1))

    recent.dropAhead(2)
    await ahead

    expect(stream.cancelled).toEqual([name(2)])
    expect(recent.recentIds().size).toBe(0)
    expect(recent.recentUri(song(2))).toBeNull()
  })

  it('keeps a song fetched ahead that was whole before it stopped coming', async () => {
    native = new FakeStream({ held: true })
    const stream = native
    const recent = await port()
    const ahead = recent.keepRecentlyPlayed(song(2))
    await vi.waitFor(() => expect(stream.upstream).toHaveLength(1))
    stream.arrive(name(2), 3_000_000)
    await ahead

    recent.dropAhead(2)

    expect(stream.cancelled).toEqual([])
    expect(recent.recentUri(song(2))).toBe(cached(2))
  })
})

describe('keeping a song that was played', () => {
  it('fetches it from the bucket with the bearer, and has an address for it after', async () => {
    const recent = await port()
    expect(recent.recentUri(song(1))).toBeNull()

    await recent.keepRecentlyPlayed(song(1))

    expect(downloads).toEqual([
      {
        url: `https://doorman.example/v1/files/audio/${HASH(1)}.m4a`,
        headers: { Authorization: 'Bearer t' },
      },
    ])
    expect(recent.recentUri(song(1))).toBe(cached(1))
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
    expect(recent.recentUri(song(1))).toBeNull()
    expect([...disk.keys()].filter(path => path.includes(HASH(1)))).toEqual([])
    expect(recent.recentIds().size).toBe(0)
  })

  it('remembers across a restart', async () => {
    await (await port()).keepRecentlyPlayed(song(1))
    vi.resetModules()
    expect((await port()).recentUri(song(1))).toBe(cached(1))
  })
})

describe('what the system cleared', () => {
  it('is not offered as an address', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    disk.delete(cached(1))
    // A `file://` with nothing behind it would play as silence in place of a
    // song that could have streamed.
    expect(recent.recentUri(song(1))).toBeNull()
  })

  it('is fetched again the next time it is played, and dropped from the note meanwhile', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    disk.delete(cached(1))

    await recent.keepRecentlyPlayed(song(2))
    expect(recent.recentIds()).toEqual(new Set([2]))

    await recent.keepRecentlyPlayed(song(1))
    expect(downloads).toHaveLength(3)
    expect(recent.recentUri(song(1))).toBe(cached(1))
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

describe('a song whose audio has changed', () => {
  it('is not played from the copy of the old audio', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    expect(recent.recentUri(replaced(1))).toBeNull()
  })

  it('is fetched again when played, and the old copy goes', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))

    await recent.keepRecentlyPlayed(replaced(1))

    expect(downloads).toHaveLength(2)
    expect(disk.has(cached(1))).toBe(false)
    expect(recent.recentUri(replaced(1))).toBe(replacedCopy)
  })

  it('is downloaded, not given the old copy', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    const destination = new FakeFile(
      new FakeDirectory('file:///document', 'songs'),
      `${'f'.repeat(64)}.m4a`,
    )

    // A download of the old audio under the new name would play the old song.
    expect(await recent.adoptRecent(replaced(1), destination as never)).toBeNull()
    expect(disk.has(destination.uri)).toBe(false)
    expect(disk.has(cached(1))).toBe(false)
    expect(recent.recentIds().size).toBe(0)
  })
})

describe('removing', () => {
  it('deletes the copy of a song removed by hand', async () => {
    const recent = await port()
    await recent.keepRecentlyPlayed(song(1))
    await recent.keepRecentlyPlayed(song(2))

    recent.forgetRecent([1])

    expect(disk.has(cached(1))).toBe(false)
    expect(recent.recentUri(song(1))).toBeNull()
    expect(recent.recentUri(song(2))).toBe(cached(2))
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
