import type { MetadataCandidate } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { USER_AGENT } from '../config.js'
import { RateLimiter } from './rateLimiter.js'
import { rankCandidates, type LookupQuery } from './lookupScore.js'
import { coverArtArchiveUrl, parseItunes, parseMusicBrainz } from './lookupParsers.js'

/**
 * Metadata lookup against free public databases.
 *
 * Two providers, no API keys:
 *  - iTunes Search — fast, good artwork, generous rate limits.
 *  - MusicBrainz — the better catalogue, but strictly one request per second
 *    and cover art lives in a separate archive that must be asked per release.
 *
 * Every failure mode (timeout, DNS, HTML error page, rate-limit 503) ends in
 * an empty list plus a warning. A lookup is a suggestion, never a 500.
 */

const REQUEST_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** A failed lookup is retried sooner than a successful one is refreshed. */
const FAILURE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 500
/** How many MusicBrainz recordings get a Cover Art Archive check. */
const MUSICBRAINZ_ART_CHECKS = 3
const RELEASES_PER_RECORDING = 2

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface MetadataProvider {
  readonly name: MetadataCandidate['source']
  search(query: LookupQuery): Promise<MetadataCandidate[]>
}

interface ProviderDeps {
  readonly fetch: FetchLike
  readonly logger: Logger
  /** How long one request may take; a test hands in a short one. */
  readonly timeoutMs?: number
}

/**
 * GET a JSON document with a timeout. Returns null on any failure, after
 * logging why — the callers all treat "no answer" as "no candidates".
 */
async function getJson(deps: ProviderDeps, url: string): Promise<unknown> {
  try {
    const response = await deps.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      deps.logger.warn('lookup request failed', { url, status: response.status })
      return null
    }
    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      deps.logger.warn('lookup returned a non-JSON body', { url, bytes: text.length })
      return null
    }
  } catch (error) {
    deps.logger.warn('lookup request errored', {
      url,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function searchTerm(query: LookupQuery): string {
  return `${query.artist} ${query.title}`.trim()
}

// --- iTunes ---------------------------------------------------------------

export class ItunesProvider implements MetadataProvider {
  readonly name = 'itunes' as const
  readonly #deps: ProviderDeps

  constructor(deps: ProviderDeps) {
    this.#deps = deps
  }

  async search(query: LookupQuery): Promise<MetadataCandidate[]> {
    const params = new URLSearchParams({
      term: searchTerm(query),
      entity: 'song',
      limit: '5',
    })
    const payload = await getJson(
      this.#deps,
      `https://itunes.apple.com/search?${params.toString()}`,
    )
    return payload === null ? [] : parseItunes(payload, query)
  }
}

// --- MusicBrainz ------------------------------------------------------------

/** Lucene special characters that would otherwise change the query's meaning. */
function luceneEscape(value: string): string {
  return value
    .replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class MusicBrainzProvider implements MetadataProvider {
  readonly name = 'musicbrainz' as const
  readonly #deps: ProviderDeps
  readonly #limiter: RateLimiter

  constructor(deps: ProviderDeps, limiter = new RateLimiter(1_100)) {
    this.#deps = deps
    this.#limiter = limiter
  }

  async search(query: LookupQuery): Promise<MetadataCandidate[]> {
    const title = luceneEscape(query.title)
    if (!title) return []
    const artist = luceneEscape(query.artist)
    const lucene = artist ? `recording:"${title}" AND artist:"${artist}"` : `recording:"${title}"`
    const params = new URLSearchParams({ query: lucene, fmt: 'json', limit: '5' })

    await this.#limiter.acquire()
    const payload = await getJson(
      this.#deps,
      `https://musicbrainz.org/ws/2/recording?${params.toString()}`,
    )
    if (payload === null) return []

    const matches = parseMusicBrainz(payload, query).sort(
      (a, b) => b.candidate.score - a.candidate.score,
    )

    // Only the likeliest recordings are worth an art check; the rest are shown
    // without a thumbnail rather than costing a round trip each.
    const withArt = await Promise.all(
      matches.map(async (match, index) => {
        if (index >= MUSICBRAINZ_ART_CHECKS) return match.candidate
        const artworkUrl = await this.#findCoverArt(match.releaseIds)
        return artworkUrl ? { ...match.candidate, artworkUrl } : match.candidate
      }),
    )
    return withArt
  }

  /**
   * The Cover Art Archive answers a HEAD with a redirect when art exists and a
   * 404 when it does not, so a check costs no image bytes.
   */
  async #findCoverArt(releaseIds: string[]): Promise<string | null> {
    for (const releaseId of releaseIds.slice(0, RELEASES_PER_RECORDING)) {
      const url = coverArtArchiveUrl(releaseId)
      try {
        const response = await this.#deps.fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(this.#deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
        if (response.ok || (response.status >= 300 && response.status < 400)) return url
      } catch (error) {
        this.#deps.logger.debug('cover art check failed', {
          url,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return null
  }
}

// --- the service --------------------------------------------------------------

interface CacheEntry {
  readonly candidates: MetadataCandidate[]
  readonly expiresAt: number
}

export class MetadataLookupService {
  readonly #providers: readonly MetadataProvider[]
  readonly #logger: Logger
  readonly #cache = new Map<string, CacheEntry>()
  readonly #inFlight = new Map<string, Promise<MetadataCandidate[]>>()

  constructor(logger: Logger, providers?: readonly MetadataProvider[], fetchImpl?: FetchLike) {
    this.#logger = logger.child('lookup')
    const deps: ProviderDeps = { fetch: fetchImpl ?? fetch, logger: this.#logger }
    this.#providers = providers ?? [new ItunesProvider(deps), new MusicBrainzProvider(deps)]
  }

  /**
   * Candidates from every provider, best first.
   *
   * Cached per (title, artist, album, duration) so re-opening the dialog is
   * free, and de-duplicated in flight so two quick opens do not double-hit
   * MusicBrainz.
   */
  async lookup(query: LookupQuery): Promise<MetadataCandidate[]> {
    if (!query.title.trim()) return []

    const key = [query.title, query.artist, query.album, Math.round(query.duration)]
      .map(part => String(part).toLowerCase().trim())
      .join('\0')

    const cached = this.#cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.candidates

    const pending = this.#inFlight.get(key)
    if (pending) return pending

    const run = this.#run(query)
      .then(candidates => {
        this.#remember(key, candidates)
        return candidates
      })
      .finally(() => this.#inFlight.delete(key))
    this.#inFlight.set(key, run)
    return run
  }

  async #run(query: LookupQuery): Promise<MetadataCandidate[]> {
    const results = await Promise.all(
      this.#providers.map(async provider => {
        try {
          return await provider.search(query)
        } catch (error) {
          // A provider throwing is a bug in the provider, not a reason to
          // fail the other one — degrade to "no candidates from this source".
          this.#logger.warn('provider failed', {
            provider: provider.name,
            message: error instanceof Error ? error.message : String(error),
          })
          return []
        }
      }),
    )
    return rankCandidates(results.flat())
  }

  #remember(key: string, candidates: MetadataCandidate[]): void {
    if (this.#cache.size >= CACHE_MAX_ENTRIES) {
      // Maps iterate in insertion order, so the first key is the oldest.
      const oldest = this.#cache.keys().next().value
      if (oldest !== undefined) this.#cache.delete(oldest)
    }
    const ttl = candidates.length > 0 ? CACHE_TTL_MS : FAILURE_TTL_MS
    this.#cache.set(key, { candidates, expiresAt: Date.now() + ttl })
  }
}
