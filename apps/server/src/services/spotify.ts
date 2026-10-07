import { cleanArtist, cleanTitle, type SpotifyLink } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { BROWSER_USER_AGENT, type FetchLike } from './fetching.js'
import { parseDurationValue, type ListedTrack } from './trackLists.js'

/**
 * A Spotify playlist, album or track, read from its public embed page.
 *
 * Spotify's audio cannot be downloaded: this reads only the names and
 * lengths, and each song is then found on YouTube (youtubeMatch.ts). The embed
 * page is used because it needs no sign-in and no developer key; a private
 * playlist has none, and says so.
 */

const SPOTIFY_TIMEOUT_MS = 15_000

/** A Spotify page's songs, with its name. */
export interface SpotifyList {
  readonly title: string | null
  readonly tracks: ListedTrack[]
}

export class SpotifyLists {
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#logger = logger.child('spotify')
    this.#fetch = fetchImpl
  }

  /** The songs a link opens. Throws, with what to do instead, when Spotify will not say. */
  async list(link: SpotifyLink): Promise<SpotifyList> {
    let html: string
    try {
      const response = await this.#fetch(`https://open.spotify.com/embed/${link.kind}/${link.id}`, {
        signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
        headers: { 'user-agent': BROWSER_USER_AGENT, accept: 'text/html' },
      })
      if (!response.ok) throw new Error(`Spotify answered ${response.status}`)
      html = await response.text()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#logger.warn('spotify fetch failed', { link, message })
      throw new Error(`Could not reach Spotify (${message}). ${INSTEAD}`)
    }
    const parsed = parseSpotifyEmbed(html)
    if (!parsed || parsed.tracks.length === 0) {
      throw new Error(`Could not read that from Spotify: it may be private. ${INSTEAD}`)
    }
    return parsed
  }
}

const INSTEAD =
  'Paste its songs as a list instead, one per line, or a CSV exported with exportify.net.'

/**
 * The songs out of a Spotify embed page.
 *
 * The page is a Next.js app whose data is serialised into a `__NEXT_DATA__`
 * script tag. Rather than depend on the exact path (which Spotify moves every
 * few months), the JSON is walked for the first object with a `trackList`; a
 * track's own page has none, and is the track.
 */
export function parseSpotifyEmbed(html: string): SpotifyList | null {
  const match = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!match?.[1]) return null

  let json: unknown
  try {
    json = JSON.parse(match[1])
  } catch {
    return null
  }

  const list = findEntity(json, 0, record => Array.isArray(record['trackList']))
  if (list) {
    const name = text(list['name']) || text(list['title']) || null
    // An album's songs are all on it; a playlist's rows do not say.
    const album = list['type'] === 'album' && name ? cleanTitle(name) : ''
    const tracks = (list['trackList'] as unknown[]).flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const track = listed(text(record['title']), text(record['subtitle']), record['duration'])
      return track ? [{ ...track, album }] : []
    })
    return { title: name, tracks }
  }

  const single = findEntity(json, 0, record => record['type'] === 'track')
  if (!single) return null
  const artists = Array.isArray(single['artists']) ? (single['artists'] as unknown[]) : []
  const first = artists[0] as Record<string, unknown> | undefined
  const track = listed(
    text(single['name']) || text(single['title']),
    text(first?.['name']),
    single['duration'],
  )
  return track ? { title: null, tracks: [track] } : null
}

/** One row as a track; null for a row with no name. Several artists are "A, B": the first leads. */
function listed(title: string, artists: string, duration: unknown): ListedTrack | null {
  const name = cleanTitle(title)
  if (!name) return null
  return {
    title: name,
    artist: cleanArtist(artists.split(/\s*,\s*/)[0] ?? ''),
    album: '',
    duration: typeof duration === 'number' ? parseDurationValue(String(duration), 'ms') : 0,
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function findEntity(
  node: unknown,
  depth: number,
  wanted: (record: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  if (depth > 12 || node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findEntity(child, depth + 1, wanted)
      if (found) return found
    }
    return null
  }
  const record = node as Record<string, unknown>
  if (wanted(record)) return record
  for (const child of Object.values(record)) {
    const found = findEntity(child, depth + 1, wanted)
    if (found) return found
  }
  return null
}
