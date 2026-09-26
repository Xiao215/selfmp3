import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The cover policy on its own, over a fake platform.
 *
 * What the two platform tests cannot reach from outside: that a synchronous
 * prime is silent and an asynchronous one announces. A phone reads its folder
 * inline, so the first `coverFor()` already knows the kept covers and there is
 * nobody to tell; web answers from a shell call afterwards, so whoever has
 * already drawn a letter tile has to hear about it. One rule, and the
 * difference is only when the platform calls `found`.
 */

/** A song's cover key, where a test names one; `covers/hash-<id>.jpg` otherwise. */
const coverKeys = new Map<number, string>()
const keyOf = (songId: number): string => coverKeys.get(songId) ?? `covers/hash-${songId}.jpg`

const replica = {
  library: {
    cloudCoverKey: vi.fn(async (songId: number) => keyOf(songId)),
    cloudCoverKeyNow: (songId: number) => keyOf(songId),
  },
  cloudPlatform: { doormanUrl: 'https://doorman.example' },
  session: { loadSession: vi.fn(async () => ({ token: 't' })) },
  doormanFileUrl: (key: string) => `https://doorman.example/v1/files/${key}`,
  doormanAuth: (token: string) => ({ Authorization: `Bearer ${token}` }),
}
vi.mock('../replica', () => replica)

const { createCoverStore } = await import('./coverStore')
type Platform = Parameters<typeof createCoverStore>[0]

/** A platform that keeps names in memory, priming however the test asks. */
function fakePlatform(overrides: Partial<Platform> = {}): Platform {
  const held = new Set<string>()
  return {
    canKeep: () => true,
    prime: () => undefined,
    haveCloud: async name => (held.has(name) ? `file:///${name}` : null),
    keepCloud: async name => {
      held.add(name)
      return `file:///${name}`
    },
    keepServed: async name => {
      held.add(name)
      return `file:///${name}`
    },
    listCloud: async () => [...held],
    removeCloud: async name => {
      held.delete(name)
    },
    forgetFiles: async () => held.clear(),
    ...overrides,
  }
}

/** Long enough for coverChanges' 16 ms frame to have carried an announcement. */
const aFrame = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 40))

describe('the cover store', () => {
  beforeEach(() => {
    coverKeys.clear()
    replica.library.cloudCoverKey.mockClear()
    replica.session.loadSession.mockClear()
    replica.session.loadSession.mockResolvedValue({ token: 't' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('looks on the disk for a cloud cover once, not on every read, until it is fetched', async () => {
    // Each look is a file check on the JS thread, and every render of a row reads.
    const peekCloud = vi.fn((_name: string): string | null => null)
    const store = createCoverStore(fakePlatform({ peekCloud }))

    expect(store.coverFor(5)).toBeUndefined()
    expect(store.coverFor(5)).toBeUndefined()
    expect(peekCloud).toHaveBeenCalledTimes(1)

    await store.ensureCover(5)
    expect(store.coverFor(5)).toBe('file:///hash-5.jpg')
  })

  it('has a synchronous prime in the very first read, and tells nobody', async () => {
    const store = createCoverStore(
      fakePlatform({ prime: found => found(12, 'r1', 'file:///12-r1.jpg') }),
    )
    const heard: number[] = []
    store.subscribeCovers(changed => heard.push(...changed))

    // Before any await: the phone's whole reason for priming inline.
    expect(store.coverFor(12)).toBe('file:///12-r1.jpg')

    await aFrame()
    expect(heard).toEqual([])
  })

  it('announces a prime that answers after the read it missed', async () => {
    const store = createCoverStore(
      fakePlatform({
        prime: found => {
          void Promise.resolve().then(() => found(12, 'r1', 'file:///12-r1.jpg'))
        },
      }),
    )
    const heard: number[] = []
    store.subscribeCovers(changed => heard.push(...changed))

    expect(store.coverFor(12)).toBeUndefined()
    await aFrame()
    expect(store.coverFor(12)).toBe('file:///12-r1.jpg')
    expect(heard).toEqual([12])
  })

  it('fetches a cloud cover once for however many rows ask at the same time', async () => {
    const platform = fakePlatform()
    const keepCloud = vi.spyOn(platform, 'keepCloud')
    const store = createCoverStore(platform)

    const uris = await Promise.all([
      store.ensureCover(7),
      store.ensureCover(7),
      store.ensureCover(7),
    ])

    expect(uris).toEqual(Array(3).fill('file:///hash-7.jpg'))
    expect(keepCloud).toHaveBeenCalledTimes(1)
    expect(keepCloud.mock.calls[0]?.[1]).toBe('https://doorman.example/v1/files/covers/hash-7.jpg')
    // Resolved: answered from memory, without asking the platform again.
    await store.ensureCover(7)
    expect(replica.library.cloudCoverKey).toHaveBeenCalledTimes(1)
  })

  it('asks again for a cover that failed, but only after a while', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const platform = fakePlatform()
    const keepCloud = vi
      .spyOn(platform, 'keepCloud')
      .mockRejectedValueOnce(new Error('the bucket had a bad minute'))
    const store = createCoverStore(platform)

    expect(await store.ensureCover(3)).toBeNull()
    expect(await store.ensureCover(3)).toBeNull()
    expect(keepCloud).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_001)
    expect(await store.ensureCover(3)).toBe('file:///hash-3.jpg')
    expect(keepCloud).toHaveBeenCalledTimes(2)
  })

  it('asks the bucket for nothing while it is refusing for the day', async () => {
    const { holdBucket, releaseBucket } = await import('@selfmp3/replica')
    const keepCloud = vi.fn(async (name: string) => `file:///${name}`)
    const store = createCoverStore(fakePlatform({ keepCloud }))
    holdBucket('Backblaze says the day’s allowance is used up.')
    try {
      expect(await store.ensureCover(7)).toBeNull()
      expect(keepCloud).not.toHaveBeenCalled()
    } finally {
      releaseBucket()
    }
  })

  it('puts a kept server cover in front of a cloud one', async () => {
    const store = createCoverStore(fakePlatform())
    await store.ensureCover(7)
    expect(store.coverFor(7)).toBe('file:///hash-7.jpg')

    await store.ensureServerCover(7, 'r2', 'https://mac.example/art/7')
    expect(store.coverFor(7)).toBe('file:///7-r2.jpg')
  })

  it('asks a server for a cover once per address, however many rows draw it', async () => {
    const platform = fakePlatform()
    const keepServed = vi.spyOn(platform, 'keepServed')
    const store = createCoverStore(platform)
    const url = 'https://mac.example/art/7'

    await Promise.all([
      store.ensureServerCover(7, 'r1', url),
      store.ensureServerCover(7, 'r1', url),
    ])
    await store.ensureServerCover(7, 'r1', url)

    expect(keepServed).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all where the platform cannot keep a file', async () => {
    const platform = fakePlatform({ canKeep: () => false })
    const keepCloud = vi.spyOn(platform, 'keepCloud')
    const store = createCoverStore(platform)

    expect(await store.ensureCover(7)).toBeNull()
    await expect(
      store.ensureServerCover(7, 'r1', 'https://mac.example/art/7'),
    ).resolves.toBeUndefined()
    expect(store.coverFor(7)).toBeUndefined()
    expect(keepCloud).not.toHaveBeenCalled()
  })

  it('forgets everything at sign-out, and does not read the folder again', async () => {
    let primes = 0
    const store = createCoverStore(
      fakePlatform({
        prime: found => {
          primes += 1
          found(12, 'r1', 'file:///12-r1.jpg')
        },
      }),
    )
    await store.ensureCover(7)
    expect(store.coverFor(7)).toBeDefined()
    expect(store.coverFor(12)).toBeDefined()
    expect(primes).toBe(1)

    await store.forgetCovers()

    expect(store.coverFor(7)).toBeUndefined()
    expect(store.coverFor(12)).toBeUndefined()
    // The folder is empty once the clear settles; reading it again is what put
    // back every name that was about to be deleted.
    expect(primes).toBe(1)
    // Another account's song 7 is fetched afresh, not answered from memory.
    await store.ensureCover(7)
    expect(replica.library.cloudCoverKey).toHaveBeenCalledTimes(2)
  })

  it('fetches a picture by its key once, and draws it from then on', async () => {
    const platform = fakePlatform()
    const keepCloud = vi.spyOn(platform, 'keepCloud')
    const store = createCoverStore(platform)
    const heard: number[] = []
    store.subscribePictures(() => heard.push(store.picturesVersion()))
    const key = `covers/${'b'.repeat(64)}.jpg`

    expect(store.pictureFor(key)).toBeUndefined()
    const uris = await Promise.all([store.ensurePicture(key), store.ensurePicture(key)])

    expect(uris).toEqual(Array(2).fill(`file:///${'b'.repeat(64)}.jpg`))
    expect(keepCloud).toHaveBeenCalledTimes(1)
    expect(store.pictureFor(key)).toBe(`file:///${'b'.repeat(64)}.jpg`)
    expect(heard.length).toBeGreaterThan(0)
  })

  it('asks again for a picture that failed, but only after a while', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const platform = fakePlatform()
    const keepCloud = vi
      .spyOn(platform, 'keepCloud')
      .mockRejectedValueOnce(new Error('Transaction cap exceeded'))
    const store = createCoverStore(platform)
    const key = `covers/${'c'.repeat(64)}.jpg`

    expect(await store.ensurePicture(key)).toBeNull()
    expect(await store.ensurePicture(key)).toBeNull()
    expect(keepCloud).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_001)
    expect(await store.ensurePicture(key)).toBe(`file:///${'c'.repeat(64)}.jpg`)
  })

  it('sweeps the bucket pictures the library no longer names, and only those', async () => {
    const old = 'a'.repeat(64)
    const now = 'd'.repeat(64)
    const artist = 'e'.repeat(64)
    const platform = fakePlatform()
    const removeCloud = vi.spyOn(platform, 'removeCloud')
    const store = createCoverStore(platform)

    // Song 9's cover as it was, then made again (squared) under a new hash.
    coverKeys.set(9, `covers/${old}.jpg`)
    await store.ensureCover(9)
    await store.ensurePicture(`covers/${artist}.jpg`)
    await store.ensureServerCover(4, 'r1', 'https://mac.example/art/4')
    coverKeys.set(9, `covers/${now}.png`)
    await aFrame()
    const heard: number[] = []
    store.subscribeCovers(changed => heard.push(...changed))

    const swept = await store.sweepPictures(new Set([`covers/${now}.png`, `covers/${artist}.jpg`]))

    expect(swept).toBe(1)
    expect(removeCloud.mock.calls).toEqual([[`${old}.jpg`]])
    // A server's cover is named by song and revision, and is not the bucket's to sweep.
    expect(await platform.listCloud()).toContain('4-r1.jpg')
    // The song drawn from the deleted file looks again, under its key now.
    await aFrame()
    expect(heard).toEqual([9])
    expect(await store.ensureCover(9)).toBe(`file:///${now}.png`)
  })

  it('survives a platform that refuses to clear', async () => {
    const store = createCoverStore(
      fakePlatform({ forgetFiles: () => Promise.reject(new Error('locked')) }),
    )
    await expect(store.forgetCovers()).resolves.toBeUndefined()
  })
})
