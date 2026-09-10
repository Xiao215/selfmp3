import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.js'
import { RateLimiter } from './rateLimiter.js'
import {
  ItunesProvider,
  MetadataLookupService,
  MusicBrainzProvider,
  type FetchLike,
} from './lookup.js'

const logger = createLogger('silent')
const query = { title: 'Bohemian Rhapsody', artist: 'Queen', album: '', duration: 355 }

function fixtureText(name: string): string {
  return fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
}

/** A fetch that answers by host, so one fake serves both providers. */
function fakeFetch(
  answer: (url: string, init?: RequestInit) => Response | Promise<Response>,
): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const impl = ((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    return Promise.resolve(answer(url, init))
  }) as FetchLike & { calls: string[] }
  impl.calls = calls
  return impl
}

const noWait = new RateLimiter(0, { sleep: () => Promise.resolve() })

describe('MetadataLookupService', () => {
  it('merges both providers, best first', async () => {
    const fetch = fakeFetch(url => {
      if (url.startsWith('https://itunes.apple.com/'))
        return new Response(fixtureText('itunes-search.json'))
      if (url.startsWith('https://musicbrainz.org/')) {
        return new Response(fixtureText('musicbrainz-recording.json'))
      }
      // Cover Art Archive: only the official release has art.
      return new Response(null, {
        status: url.includes('8e9b7a34') ? 307 : 404,
        headers: url.includes('8e9b7a34') ? { location: 'https://archive.org/x.jpg' } : {},
      })
    })
    const deps = { fetch, logger }
    const service = new MetadataLookupService(logger, [
      new ItunesProvider(deps),
      new MusicBrainzProvider(deps, noWait),
    ])

    const candidates = await service.lookup(query)
    expect(candidates.length).toBeGreaterThanOrEqual(4)
    expect(candidates[0]?.score).toBe(1)
    expect(new Set(candidates.map(c => c.source))).toEqual(new Set(['itunes', 'musicbrainz']))

    const mb = candidates.find(
      c => c.source === 'musicbrainz' && c.album === 'A Night at the Opera',
    )
    expect(mb?.artworkUrl).toBe(
      'https://coverartarchive.org/release/8e9b7a34-2d09-4e5c-9b3e-0f5f9d5e5a61/front-500',
    )
    // The bootleg was checked and rejected; the archive was asked with HEAD.
    expect(fetch.calls.some(c => c.startsWith('HEAD https://coverartarchive.org/'))).toBe(true)
  })

  it('caches a successful lookup and de-duplicates in-flight requests', async () => {
    const fetch = fakeFetch(() => new Response(fixtureText('itunes-search.json')))
    const service = new MetadataLookupService(logger, [new ItunesProvider({ fetch, logger })])

    const [a, b] = await Promise.all([service.lookup(query), service.lookup(query)])
    await service.lookup({ ...query })
    expect(a).toBe(b)
    expect(fetch.calls).toHaveLength(1)
  })

  it('returns no candidates for a song with no title', async () => {
    const fetch = fakeFetch(() => new Response('{}'))
    const service = new MetadataLookupService(logger, [new ItunesProvider({ fetch, logger })])
    expect(await service.lookup({ ...query, title: '  ' })).toEqual([])
    expect(fetch.calls).toHaveLength(0)
  })

  describe('resilience', () => {
    const warn = vi.fn()
    const loud = { ...logger, warn, child: () => ({ ...logger, warn, child: () => loud }) }

    it('turns a non-JSON body into an empty list plus a warning', async () => {
      const fetch = fakeFetch(() => new Response('<html>Service Unavailable</html>'))
      const service = new MetadataLookupService(loud, [new ItunesProvider({ fetch, logger: loud })])
      warn.mockClear()
      expect(await service.lookup(query)).toEqual([])
      expect(warn).toHaveBeenCalledWith('lookup returned a non-JSON body', expect.anything())
    })

    it('turns a 503 into an empty list plus a warning', async () => {
      const fetch = fakeFetch(() => new Response('busy', { status: 503 }))
      const service = new MetadataLookupService(loud, [
        new MusicBrainzProvider({ fetch, logger: loud }, noWait),
      ])
      warn.mockClear()
      expect(await service.lookup(query)).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        'lookup request failed',
        expect.objectContaining({ status: 503 }),
      )
    })

    it('turns a network error into an empty list plus a warning', async () => {
      const fetch = (() => Promise.reject(new Error('ENOTFOUND'))) as FetchLike
      const service = new MetadataLookupService(loud, [new ItunesProvider({ fetch, logger: loud })])
      warn.mockClear()
      expect(await service.lookup(query)).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        'lookup request errored',
        expect.objectContaining({ message: 'ENOTFOUND' }),
      )
    })

    it('honours the abort signal, so a hung server cannot stall the request', async () => {
      const fetch = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })) as FetchLike
      vi.useFakeTimers()
      try {
        const service = new MetadataLookupService(loud, [
          new ItunesProvider({ fetch, logger: loud }),
        ])
        const pending = service.lookup(query)
        await vi.advanceTimersByTimeAsync(8_500)
        expect(await pending).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps the other provider when one throws outright', async () => {
      const broken = {
        name: 'musicbrainz' as const,
        search: () => Promise.reject(new Error('boom')),
      }
      const fetch = fakeFetch(() => new Response(fixtureText('itunes-search.json')))
      const service = new MetadataLookupService(loud, [
        new ItunesProvider({ fetch, logger: loud }),
        broken,
      ])
      const candidates = await service.lookup(query)
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates.every(c => c.source === 'itunes')).toBe(true)
    })
  })
})

/**
 * Live check against the real iTunes API. Off by default so `npm test` stays
 * offline-safe; run with `SELFMP3_LIVE_TESTS=1 npm test` to confirm the
 * parser still agrees with what Apple actually sends.
 */
describe.skipIf(!process.env['SELFMP3_LIVE_TESTS'])('iTunes (live)', () => {
  it('finds Bohemian Rhapsody with artwork', async () => {
    const provider = new ItunesProvider({ fetch, logger })
    const candidates = await provider.search(query)
    expect(candidates.length).toBeGreaterThan(0)
    const best = candidates.sort((a, b) => b.score - a.score)[0]
    expect(best?.artist).toBe('Queen')
    expect(best?.artworkUrl).toMatch(/600x600bb/)
    expect(best?.score).toBeGreaterThanOrEqual(0.85)
  }, 20_000)
})
