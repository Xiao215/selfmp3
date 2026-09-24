import type { Logger } from '../logger.js'
import type { ProbedTrack } from './ytdlp.js'
import { findAll, findKey, runs, YouTubeMusicApi, type FetchLike } from './youtubeMusicApi.js'

/**
 * Lists of songs from YouTube Music itself: a search, an album, a playlist.
 *
 * yt-dlp reads all three as playlists, and its flat listing names each song
 * by title and uploader alone — no album, no length for a search, a video
 * still for a cover. YouTube Music's own pages carry the rest in one request:
 * the artist runs, the album, the length, square art. So the review shows
 * what will be written, and the import writes it.
 *
 * Every answer is null when YouTube Music does not answer. A list it answers
 * only part of is handed over as it is and says so (`complete`): the caller
 * has yt-dlp read the whole of it, and keeps what YouTube Music said of each
 * song it did name (importPreview.ts).
 */

/** The search filter for songs, as the YouTube Music web app sends it. */
const SONGS_FILTER = 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D'

/** A list with a name: an album's, a playlist's. */
export interface SongList {
  readonly title: string
  readonly tracks: ProbedTrack[]
  /** Whether every song the page counts is in `tracks`; see `whole`. */
  readonly complete: boolean
}

export class YouTubeMusicLists {
  readonly #api: YouTubeMusicApi

  constructor(logger: Logger, fetchImpl?: FetchLike) {
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
  }

  /** The songs a search finds, or null when YouTube Music did not answer. */
  async songs(query: string): Promise<ProbedTrack[] | null> {
    const page = await this.#api.post('search', { query, params: SONGS_FILTER })
    if (!page) return null
    return rows(page, {})
  }

  /**
   * An album's songs. Its rows name only the title and length; the artist and
   * the cover are the page's, and the album is the page's title.
   */
  async album(browseId: string): Promise<SongList | null> {
    const page = await this.#api.post('browse', { browseId })
    if (!page) return null
    const header = pageHeader(page)
    if (!header.title) return null
    const tracks = rows(page, {
      artist: header.artist,
      album: header.title,
      thumbnail: header.thumbnail,
    })
    if (tracks.length === 0) return null
    return { title: header.title, tracks, complete: whole(header, tracks) }
  }

  /**
   * A playlist's songs. Each row names its own artist, album and cover; the
   * page only names the playlist.
   *
   * An album's own playlist — the `OLAK5uy_…` list a `watch?v=…&list=` link
   * from an album carries — is answered with rows and no header at all, and
   * used to be handed to yt-dlp for that, whose listing has no album: the
   * review showed the album's songs with the album column blank, and the
   * songs arrived with one. Its rows each name the album they are from, and
   * the album's own page has the title, artist, cover and count.
   */
  async playlist(playlistId: string): Promise<SongList | null> {
    const page = await this.#api.post('browse', { browseId: `VL${playlistId}` })
    if (!page) return null
    const header = pageHeader(page)
    if (!header.title) {
      const albumId = albumIdIn(page)
      return albumId ? this.album(albumId) : null
    }
    const tracks = rows(page, {})
    if (tracks.length === 0) return null
    return { title: header.title, tracks, complete: whole(header, tracks) }
  }
}

/** What the page says about itself: name, artist, cover, and how many songs it holds. */
interface PageHeader {
  readonly title: string
  readonly artist: string
  readonly thumbnail: string | null
  /** "9 songs • 32 minutes": how many rows there should be, or null when unsaid. */
  readonly count: number | null
}

function pageHeader(page: unknown): PageHeader {
  const header = (findKey(page, 'musicResponsiveHeaderRenderer') ??
    findKey(page, 'musicDetailHeaderRenderer') ??
    {}) as Record<string, unknown>
  const thumbnails = findKey(header['thumbnail'], 'thumbnails')
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined
  const counted = /(\d[\d,]*)\s+(song|track)/i.exec(runs(header['secondSubtitle']).join(''))
  return {
    title: runs(header['title']).join('').trim(),
    artist: artistsIn(header['straplineTextOne'] ?? header['subtitle']).join(', '),
    thumbnail: typeof largest === 'string' ? coverSized(largest) : null,
    count: counted?.[1] ? Number(counted[1].replaceAll(',', '')) : null,
  }
}

/**
 * Whether the page's rows are all of it. A long playlist is answered a page
 * at a time, and the page leaves out what it cannot play from here (27 of
 * the 119 songs on Yorushika's list); a review of the rows alone would import
 * those and quietly drop the rest. yt-dlp reads the whole thing, so it reads
 * the list, and these rows fill in what it saw of each song.
 */
function whole(header: PageHeader, tracks: readonly ProbedTrack[]): boolean {
  return header.count === null || tracks.length >= header.count
}

/** What a row does not say for itself, taken from the page it is on. */
interface RowDefaults {
  readonly artist?: string
  readonly album?: string
  readonly thumbnail?: string | null
}

function rows(page: unknown, defaults: RowDefaults): ProbedTrack[] {
  return findAll(page, 'musicResponsiveListItemRenderer')
    .map(item => songRow(item, defaults))
    .filter((track): track is ProbedTrack => track !== null)
}

interface Run {
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

function runsOf(value: unknown): Run[] {
  const list = (value as { runs?: unknown } | undefined)?.runs
  return Array.isArray(list) ? (list as Run[]) : []
}

function pageTypeOf(run: Run): unknown {
  return run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType
}

/** The album the page's rows are from, by the first row that names one. */
function albumIdIn(page: unknown): string | null {
  for (const item of findAll(page, 'musicResponsiveListItemRenderer')) {
    for (const column of findAll(item, 'musicResponsiveListItemFlexColumnRenderer')) {
      for (const run of runsOf((column as { text?: unknown }).text)) {
        if (pageTypeOf(run) !== 'MUSIC_PAGE_TYPE_ALBUM') continue
        const id = run.navigationEndpoint?.browseEndpoint?.browseId
        if (typeof id === 'string' && id.startsWith('MPREb_')) return id
      }
    }
  }
  return null
}

/** The names in a text block that lead to an artist's page. */
function artistsIn(value: unknown): string[] {
  return runsOf(value).flatMap(run =>
    pageTypeOf(run) === 'MUSIC_PAGE_TYPE_ARTIST' && typeof run.text === 'string'
      ? [run.text.trim()]
      : [],
  )
}

const LENGTH = /^\d+:\d\d(:\d\d)?$/

/**
 * One row of a list. The first column is the title; the others read
 * "Artist • Album • 3:45" in a search, or one thing each on an album or a
 * playlist, so the runs are read by where they lead rather than by position —
 * a song by two artists has two artist runs, a single has no album, and an
 * album's rows name neither, which the page does for them.
 */
export function songRow(item: unknown, defaults: RowDefaults = {}): ProbedTrack | null {
  const row = item as Record<string, unknown>
  const videoId = findKey(row['playlistItemData'], 'videoId')
  if (typeof videoId !== 'string') return null

  const columns = findAll(row, 'musicResponsiveListItemFlexColumnRenderer').map(column =>
    runsOf((column as { text?: unknown }).text),
  )
  const title = (columns[0] ?? [])
    .map(run => (typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim()
  if (!title) return null

  const artists: string[] = []
  let album = ''
  let duration = 0
  const texts = [
    ...columns.slice(1).flat(),
    ...findAll(row, 'musicResponsiveListItemFixedColumnRenderer').flatMap(column =>
      runsOf((column as { text?: unknown }).text),
    ),
  ]
  for (const run of texts) {
    if (typeof run.text !== 'string') continue
    const text = run.text.trim()
    const pageType = pageTypeOf(run)
    if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') artists.push(text)
    else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') album = text
    else if (LENGTH.test(text)) duration = seconds(text)
  }

  const thumbnails = findKey(row['thumbnail'], 'thumbnails')
  const largest = Array.isArray(thumbnails)
    ? (thumbnails.at(-1) as { url?: unknown } | undefined)?.url
    : undefined

  return {
    url: `https://music.youtube.com/watch?v=${videoId}`,
    title,
    artist: artists.length > 0 ? artists.join(', ') : (defaults.artist ?? ''),
    album: album || (defaults.album ?? ''),
    duration,
    thumbnail: typeof largest === 'string' ? coverSized(largest) : (defaults.thumbnail ?? null),
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
 * A listing's thumbnail is 120 px. The same address serves any size, so the
 * review's rows and the cover kept with the song ask for one worth keeping.
 */
export function coverSized(url: string): string {
  return url.replace(/=w\d+-h\d+/, '=w544-h544')
}
