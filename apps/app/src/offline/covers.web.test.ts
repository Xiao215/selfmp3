import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The cover policy on the platforms Metro calls web, over a fake of the
 * `coverFiles` port. What is pinned: one fetch for many rows, a failed fetch
 * asked again only after a while, and — the regression — forgetting covers
 * at sign-out leaves nothing behind, even while the shell is still clearing
 * the folder. Resetting `primed` there let the next render re-read the folder
 * mid-clear and put back every name about to be deleted.
 */

const kept = new Set<string>()
let clearing: Promise<void> = Promise.resolve()
const port = {
  uriFor: (name: string) => `app://selfmp3/_media/covers/${name}`,
  has: vi.fn(async (name: string) => kept.has(name)),
  keep: vi.fn(async (name: string, _url: string, _headers?: Record<string, string>) => void kept.add(name)),
  list: vi.fn(async () => [...kept]),
  forget: vi.fn(async () => {
    await clearing
    kept.clear()
  }),
}
const replica = {
  library: { cloudCoverKey: vi.fn(async (songId: number) => `covers/hash-${songId}.jpg`) },
  cloudPlatform: { doormanUrl: 'https://doorman.example' },
  session: { loadSession: vi.fn(async () => ({ token: 't' })) },
}

vi.mock('../ports/coverFiles', () => ({ get coverFiles() { return port } }))
vi.mock('../replica', () => replica)

async function covers() {
  return import('./covers.web')
}

describe('covers on the web platforms', () => {
  beforeEach(() => {
    vi.resetModules()
    kept.clear()
    clearing = Promise.resolve()
    for (const fn of [port.has, port.keep, port.list, port.forget, replica.library.cloudCoverKey]) fn.mockClear()
    replica.session.loadSession.mockResolvedValue({ token: 't' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches a cloud cover once for however many rows ask at the same time', async () => {
    const { ensureCover } = await covers()
    const uris = await Promise.all([ensureCover(7), ensureCover(7), ensureCover(7)])
    expect(uris).toEqual(Array(3).fill('app://selfmp3/_media/covers/hash-7.jpg'))
    expect(port.keep).toHaveBeenCalledTimes(1)
    expect(port.keep.mock.calls[0]?.[0]).toBe('hash-7.jpg')
    expect(port.keep.mock.calls[0]?.[1]).toBe('https://doorman.example/v1/files/covers/hash-7.jpg')
    // Resolved: answered from memory, not the disk.
    await ensureCover(7)
    expect(port.has).toHaveBeenCalledTimes(1)
  })

  it('asks again for a cover that failed, but only after a while', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    port.keep.mockRejectedValueOnce(new Error('bucket had a bad minute'))
    const { ensureCover } = await covers()
    expect(await ensureCover(3)).toBeNull()
    expect(await ensureCover(3)).toBeNull()
    expect(port.keep).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_001)
    expect(await ensureCover(3)).toBe('app://selfmp3/_media/covers/hash-3.jpg')
    expect(port.keep).toHaveBeenCalledTimes(2)
  })

  it("reads a server's kept covers once, and announces them", async () => {
    kept.add('12-r1.jpg')
    kept.add('not-a-cover.txt')
    const { coversNow, coverFor, subscribeCovers } = await covers()
    const heard: number[] = []
    subscribeCovers(changed => heard.push(...changed))
    expect(coversNow().size).toBe(0)
    await vi.waitFor(() => expect(coverFor(12)).toBe('app://selfmp3/_media/covers/12-r1.jpg'))
    await vi.waitFor(() => expect(heard).toEqual([12]))
    coversNow()
    expect(port.list).toHaveBeenCalledTimes(1)
  })

  it('forgets everything at sign-out, and stays forgotten while the folder is still being cleared', async () => {
    kept.add('12-r1.jpg')
    const { coversNow, coverFor, ensureCover, forgetCovers } = await covers()
    await ensureCover(7)
    await vi.waitFor(() => expect(coverFor(12)).toBeDefined())
    expect(coversNow().size).toBe(2)

    let finishClearing = () => undefined as void
    clearing = new Promise<void>(resolve => { finishClearing = resolve })
    const forgetting = forgetCovers()
    // The clear has not landed; a render asks in the meantime.
    expect(coversNow().size).toBe(0)
    await Promise.resolve()
    expect(coversNow().size).toBe(0)
    finishClearing()
    await forgetting

    expect(port.forget).toHaveBeenCalledTimes(1)
    expect(coversNow().size).toBe(0)
    expect(coverFor(7)).toBeUndefined()
    expect(coverFor(12)).toBeUndefined()
    // Another account's song 7 is fetched afresh, not answered from memory.
    await ensureCover(7)
    expect(replica.library.cloudCoverKey).toHaveBeenCalledTimes(2)
  })

  it('survives the shell refusing to clear', async () => {
    port.forget.mockRejectedValueOnce(new Error('locked'))
    const { forgetCovers } = await covers()
    await expect(forgetCovers()).resolves.toBeUndefined()
  })
})
