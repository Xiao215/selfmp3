import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The browser's audio cache, over a fake of the Cache API that matches the way
 * the real one does: by the whole URL, or by its path alone when asked to
 * ignore the query.
 *
 * What is pinned is the regression. A song's key is its stream address, whose
 * query names the revision (and, from a server, the token); the service worker
 * finds a copy by path, but this file matched the whole address. So a copy
 * kept before the revision changed was not "kept" here, was fetched again
 * beside itself, went on being the one the worker played, and survived being
 * removed.
 */

const ORIGIN = 'https://music.example'

class FakeCache {
  readonly entries = new Map<string, Response>()

  #find(key: RequestInfo, options?: CacheQueryOptions): string[] {
    const wanted = new URL(typeof key === 'string' ? key : key.url, ORIGIN)
    return [...this.entries.keys()].filter(stored => {
      const url = new URL(stored)
      return options?.ignoreSearch
        ? url.origin + url.pathname === wanted.origin + wanted.pathname
        : url.href === wanted.href
    })
  }

  async match(key: RequestInfo, options?: CacheQueryOptions): Promise<Response | undefined> {
    const [first] = this.#find(key, options)
    return first === undefined ? undefined : this.entries.get(first)
  }

  async put(key: RequestInfo, response: Response): Promise<void> {
    this.entries.set(new URL(typeof key === 'string' ? key : key.url, ORIGIN).href, response)
  }

  async delete(key: RequestInfo, options?: CacheQueryOptions): Promise<boolean> {
    const found = this.#find(key, options)
    for (const stored of found) this.entries.delete(stored)
    return found.length > 0
  }

  async keys(key?: RequestInfo, options?: CacheQueryOptions): Promise<Request[]> {
    const urls = key === undefined ? [...this.entries.keys()] : this.#find(key, options)
    return urls.map(url => new Request(url))
  }
}

let cache = new FakeCache()
/** The revision each song's address names right now. */
const revs = new Map<number, string>()

function song(bytes: string): Response {
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })
}

beforeEach(() => {
  cache = new FakeCache()
  revs.clear()
  vi.stubGlobal('caches', { open: async () => cache, delete: async () => true })
  vi.stubGlobal('window', { location: { protocol: 'https:' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function offline() {
  const port = await import('./offline.web')
  port.configureAudioCache({
    streamUrl: songId => `${ORIGIN}/api/stream/${songId}?v=${revs.get(songId) ?? ''}`,
  })
  return port
}

describe('the browser audio cache', () => {
  it('counts a copy kept under an older revision as kept, and sizes it', async () => {
    const { cachedBytes, isCached } = await offline()
    await cache.put(`${ORIGIN}/api/stream/7?v=r1`, song('abcd'))
    revs.set(7, 'r2')

    expect(await isCached(7)).toBe(true)
    expect((await cachedBytes([7])).get(7)).toBe(4)
  })

  it('removes every copy of a song, whatever revision it was kept under', async () => {
    const { cachedSongIds, uncacheSong } = await offline()
    await cache.put(`${ORIGIN}/api/stream/7?v=r1`, song('abcd'))
    revs.set(7, 'r2')

    await uncacheSong(7)

    expect(cache.entries.size).toBe(0)
    expect(await cachedSongIds()).toEqual(new Set())
  })

  it('replaces the old copy when a song is fetched again, rather than keeping both', async () => {
    const { cacheSong } = await offline()
    await cache.put(`${ORIGIN}/api/stream/7?v=r1`, song('old'))
    revs.set(7, 'r2')
    vi.stubGlobal('fetch', async () => song('new bytes'))

    await cacheSong(7)

    expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/api/stream/7?v=r2`])
    const kept = await cache.match(`${ORIGIN}/api/stream/7`, { ignoreSearch: true })
    expect(await kept?.text()).toBe('new bytes')
  })
})
