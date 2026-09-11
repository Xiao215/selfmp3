import type { Logger } from '../logger.js'

/**
 * The private API the YouTube Music apps speak, shared by everything here that
 * asks it something: timed lyrics (youtubeMusic.ts) and an artist's songs
 * (youtubeMusicArtist.ts).
 *
 * There is no official API; this is the one ytmusicapi uses. It can change
 * without notice, so a request that fails for any reason resolves to null, and
 * every caller reads null as "YouTube Music has nothing to say".
 */

const API = 'https://music.youtube.com/youtubei/v1/'
export const WEB_CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en' }
export const ANDROID_CLIENT = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', hl: 'en' }
const REQUEST_TIMEOUT_MS = 8_000

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class YouTubeMusicApi {
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#logger = logger.child('youtube-music')
    this.#fetch = fetchImpl
  }

  async post(endpoint: string, body: object, client: object = WEB_CLIENT): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.#fetch(`${API}${endpoint}?prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://music.youtube.com',
          // Skips the cookie-consent interstitial served to some regions.
          Cookie: 'SOCS=CAI',
        },
        body: JSON.stringify({ ...body, context: { client } }),
        signal: controller.signal,
      })
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      this.#logger.debug('lookup failed', {
        endpoint,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The text of a `{ runs: [{ text }] }` block. */
export function runs(value: unknown): string[] {
  const list = (value as { runs?: unknown } | undefined)?.runs
  if (!Array.isArray(list)) return []
  return list.map(run => (run as { text?: unknown }).text).filter(t => typeof t === 'string')
}

/** Every value under `key`, anywhere in a response. Responses nest deep and move. */
export function findAll(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) findAll(item, key, found)
  } else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      if (name === key) found.push(child)
      findAll(child, key, found)
    }
  }
  return found
}

export function findKey(value: unknown, key: string): unknown {
  return findAll(value, key)[0]
}
