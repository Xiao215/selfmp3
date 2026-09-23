import type { YouTubeChannel } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { ProbedTrack } from './ytdlp.js'
import { findAll, findKey, runs, YouTubeMusicApi, type FetchLike } from './youtubeMusicApi.js'

/**
 * An artist's songs, from their page on YouTube Music.
 *
 * A channel link on its own is not a list of songs: yt-dlp reads it as the
 * channel's tabs (Videos, Live, Shorts), and the Videos tab is vlogs and TV
 * appearances as much as music. The artist page on YouTube Music has what was
 * meant — a "Top songs" list whose "See all" is a playlist of the artist's
 * studio tracks (71 for YOASOBI), which yt-dlp reads like any other playlist.
 *
 * A channel with no songs list (YouTube calls every channel an artist, a
 * tech reviewer included) and any failure along the way are both null.
 *
 * The same page carries the wide picture YouTube Music draws behind the
 * artist's name, which is what an artist's page here is lit by (`backdrop`).
 */

export interface ArtistSongs {
  readonly artist: string
  /** "Top songs → See all", as a playlist link for yt-dlp. */
  readonly playlistUrl: string | null
  /** The list as the page shows it: all there is for an artist too small for a See all. */
  readonly tracks: readonly ProbedTrack[]
}

export class YouTubeMusicArtists {
  readonly #api: YouTubeMusicApi

  constructor(logger: Logger, fetchImpl?: FetchLike) {
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
  }

  async topSongs(channel: YouTubeChannel): Promise<ArtistSongs | null> {
    const channelId =
      'channelId' in channel ? channel.channelId : await this.#resolve(channel.handle)
    if (!channelId) return null

    const page = await this.#api.post('browse', { browseId: channelId })
    // The songs are the page's one list; everything else on it is a carousel.
    const shelf = findKey(page, 'musicShelfRenderer')
    if (!shelf) return null

    const seeAll = findAll(shelf, 'browseEndpoint')
      .map(endpoint => (endpoint as { browseId?: unknown }).browseId)
      .find((id): id is string => typeof id === 'string' && id.startsWith('VL'))
    const tracks = findAll(shelf, 'musicResponsiveListItemRenderer')
      .map(toTrack)
      .filter((track): track is ProbedTrack => track !== null)
    if (!seeAll && tracks.length === 0) return null

    return {
      artist: headerTitle(page) || tracks[0]?.artist || '',
      playlistUrl: seeAll ? `https://music.youtube.com/playlist?list=${seeAll.slice(2)}` : null,
      tracks,
    }
  }

  /**
   * The picture behind the artist's name, at the size asked for, or null for
   * a channel without one. The page names it at a few sizes; the address
   * takes its size in the path, so any size can be asked for.
   */
  async backdrop(
    channelId: string,
    size: { width: number; height: number },
  ): Promise<string | null> {
    const page = await this.#api.post('browse', { browseId: channelId })
    const url = page ? headerImage(page) : null
    if (!url) return null
    return `${url.split('=')[0]}=w${size.width}-h${size.height}-p-l90-rj`
  }

  /** `@handle` to a channel id. Only music.youtube.com links resolve, so it is asked as one. */
  async #resolve(handle: string): Promise<string | null> {
    const response = await this.#api.post('navigation/resolve_url', {
      url: `https://music.youtube.com/${handle}`,
    })
    const browseId = (findKey(response, 'browseEndpoint') as { browseId?: unknown } | undefined)
      ?.browseId
    return typeof browseId === 'string' && browseId.startsWith('UC') ? browseId : null
  }
}

/** Whichever header the page has: immersive, with the wide picture, or the plain one. */
function headerRenderer(page: unknown): Record<string, unknown> | undefined {
  const header = (page as { header?: Record<string, unknown> } | null)?.header
  return header ? (Object.values(header)[0] as Record<string, unknown> | undefined) : undefined
}

/** The artist's name, from whichever header the page has. */
function headerTitle(page: unknown): string {
  return runs(headerRenderer(page)?.['title']).join('').trim()
}

/** The largest of the header's pictures, or null where the header has none. */
function headerImage(page: unknown): string | null {
  const thumbnails = findKey(headerRenderer(page)?.['thumbnail'], 'thumbnails')
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined
  return typeof largest === 'string' ? largest : null
}

/** One row of the songs list. Columns read title, artist, plays, album. */
function toTrack(item: unknown): ProbedTrack | null {
  const row = item as Record<string, unknown>
  const videoId = findKey(row['playlistItemData'], 'videoId')
  if (typeof videoId !== 'string') return null

  const columns = findAll(row, 'musicResponsiveListItemFlexColumnRenderer').map(column =>
    runs((column as Record<string, unknown>)['text']).join(''),
  )
  const thumbnails = findKey(row['thumbnail'], 'thumbnails')
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined

  return {
    url: `https://music.youtube.com/watch?v=${videoId}`,
    title: columns[0] ?? '',
    artist: columns[1] ?? '',
    album: '',
    // Not on the page; the download reads the real length.
    duration: 0,
    thumbnail: typeof largest === 'string' ? largest : null,
  }
}
