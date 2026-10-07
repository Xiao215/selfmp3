import type { Logger } from '../logger.js'
import type { FetchLike } from './fetching.js'
import { messageOf } from '../util/errors.js'

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

/*
 * The search's "Songs" filter, as two parts of this server send it. Both ask
 * for songs only (`8a 01 02 08 01`); they differ in the result shelves they
 * name after that (`6a …`), and so in what comes back and in what order. The
 * timed-lyrics and artist-page lookups were tuned against the first and the
 * import review against the second, so each keeps its own rather than have
 * one's matches move under the other.
 */

/** Songs only, as the lyrics and artist-page lookups ask (youtubeMusicSongs.ts). */
export const SONG_SEARCH_FOR_MATCHING = 'EgWKAQIIAWoMEA4QChADEAQQCRAF'

/** Songs only, as the YouTube Music web app sends it: the import review's search (youtubeMusicLists.ts). */
export const SONG_SEARCH_AS_THE_WEB_APP = 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D'

export class YouTubeMusicApi {
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#logger = logger.child('youtube-music')
    this.#fetch = fetchImpl
  }

  async post(endpoint: string, body: object, client: object = WEB_CLIENT): Promise<unknown> {
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      this.#logger.debug('lookup failed', {
        endpoint,
        message: messageOf(error),
      })
      return null
    }
  }
}

/** One piece of a text block, and the page it leads to, if any. */
export interface Run {
  readonly text?: unknown
  readonly navigationEndpoint?: {
    readonly browseEndpoint?: {
      readonly browseId?: unknown
      readonly browseEndpointContextSupportedConfigs?: {
        readonly browseEndpointContextMusicConfig?: { readonly pageType?: unknown }
      }
    }
  }
}

/** The runs of a `{ runs: [...] }` block. */
export function runsOf(value: unknown): Run[] {
  const list = (value as { runs?: unknown } | undefined)?.runs
  return Array.isArray(list) ? (list as Run[]) : []
}

/** The text of a `{ runs: [{ text }] }` block. */
export function runs(value: unknown): string[] {
  return runsOf(value)
    .map(run => run.text)
    .filter((text): text is string => typeof text === 'string')
}

/** The kind of page a run leads to: `MUSIC_PAGE_TYPE_ARTIST`, `…_ALBUM`, or nothing. */
export function pageTypeOf(run: Run): unknown {
  return run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType
}

/** The video a list row plays, or null for a row that is not a song. */
export function rowVideoId(row: unknown): string | null {
  const videoId = findKey((row as Record<string, unknown>)['playlistItemData'], 'videoId')
  return typeof videoId === 'string' ? videoId : null
}

/** A list row's flex columns, each as its runs: the title first, then the rest. */
export function rowColumns(row: unknown): Run[][] {
  return findAll(row, 'musicResponsiveListItemFlexColumnRenderer').map(column =>
    runsOf((column as { text?: unknown }).text),
  )
}

/**
 * The address of the largest picture under `owner.thumbnail`, or null. Every
 * picture list here — a row's, a page header's — is smallest first.
 */
export function largestThumbnail(owner: unknown): string | null {
  const thumbnails = findKey(
    (owner as Record<string, unknown> | undefined)?.['thumbnail'],
    'thumbnails',
  )
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined
  return typeof largest === 'string' ? largest : null
}

/** "3:27" or "1:02:03" to seconds; null for anything else. */
export function parseLength(text: string): number | null {
  if (!/^\d+(?::\d{2}){1,2}$/.test(text.trim())) return null
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
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
