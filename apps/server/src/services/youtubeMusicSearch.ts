import type { Logger } from '../logger.js'
import type { ProbedTrack } from './ytdlp.js'
import { findAll, findKey, YouTubeMusicApi, type FetchLike } from './youtubeMusicApi.js'

/**
 * A search on YouTube Music, as its songs.
 *
 * yt-dlp reads `music.youtube.com/search?q=…` as a playlist of everything the
 * page shows — albums, the artist, playlists, videos — and its flat listing
 * names each song by title alone: no artist, no album, no length, no cover.
 * YouTube Music's own search, asked for songs only, answers with all of that
 * in one request, which is what the review wants to show and the import
 * wants to write.
 */

/** The search filter for songs, as the YouTube Music web app sends it. */
const SONGS_FILTER = 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D'

export class YouTubeMusicSearch {
  readonly #api: YouTubeMusicApi

  constructor(logger: Logger, fetchImpl?: FetchLike) {
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
  }

  /** The songs a search finds, or null when YouTube Music did not answer. */
  async songs(query: string): Promise<ProbedTrack[] | null> {
    const page = await this.#api.post('search', { query, params: SONGS_FILTER })
    if (!page) return null
    return findAll(page, 'musicResponsiveListItemRenderer')
      .map(songRow)
      .filter((track): track is ProbedTrack => track !== null)
  }
}

interface Run {
  readonly text?: unknown
  readonly navigationEndpoint?: {
    readonly browseEndpoint?: {
      readonly browseEndpointContextSupportedConfigs?: {
        readonly browseEndpointContextMusicConfig?: { readonly pageType?: unknown }
      }
    }
  }
}

/**
 * One result row. The first column is the title; the second reads
 * "Artist • Album • 3:45", each run linking to what it names, so the runs are
 * read by where they lead rather than by position — a song by two artists has
 * two artist runs, and a single has no album.
 */
export function songRow(item: unknown): ProbedTrack | null {
  const row = item as Record<string, unknown>
  const videoId = findKey(row['playlistItemData'], 'videoId')
  if (typeof videoId !== 'string') return null

  const columns = findAll(row, 'musicResponsiveListItemFlexColumnRenderer').map(column => {
    const runs = (column as { text?: { runs?: unknown } }).text?.runs
    return Array.isArray(runs) ? (runs as Run[]) : []
  })
  const title = (columns[0] ?? [])
    .map(run => (typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim()
  if (!title) return null

  const artists: string[] = []
  let album = ''
  let duration = 0
  for (const run of columns[1] ?? []) {
    if (typeof run.text !== 'string') continue
    const pageType =
      run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType
    if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') artists.push(run.text.trim())
    else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') album = run.text.trim()
    else if (/^\d+:\d\d(:\d\d)?$/.test(run.text.trim())) duration = seconds(run.text.trim())
  }

  const thumbnails = findKey(row['thumbnail'], 'thumbnails')
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined

  return {
    url: `https://music.youtube.com/watch?v=${videoId}`,
    title,
    artist: artists.join(', '),
    album,
    duration,
    thumbnail: typeof largest === 'string' ? coverSized(largest) : null,
  }
}

/** "3:45" or "1:02:03" in seconds. */
function seconds(text: string): number {
  return text
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)
}

/**
 * The listing's thumbnail is 120 px. The same address serves any size, so the
 * review's rows and the cover kept with the song ask for one worth keeping.
 */
export function coverSized(url: string): string {
  return url.replace(/=w\d+-h\d+/, '=w544-h544')
}
