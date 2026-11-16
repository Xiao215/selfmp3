import type { Logger } from '../logger.js'
import type { ProbedTrack } from './ytdlp.js'
import {
  findAll,
  findKey,
  largestThumbnail,
  pageTypeOf,
  parseLength,
  rowColumns,
  rowVideoId,
  runs,
  runsOf,
  ARTIST_SEARCH_AS_THE_WEB_APP,
  SONG_SEARCH_AS_THE_WEB_APP,
  WEB_CLIENT,
  YouTubeMusicApi,
} from './youtubeMusicApi.js'
import type { FetchLike } from './fetching.js'

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

/** A list with a name: an album's, a playlist's. */
export interface SongList {
  readonly title: string
  readonly tracks: ProbedTrack[]
  /** Whether every song the page counts is in `tracks`; see `whole`. */
  readonly complete: boolean
}

/**
 * A search's song with the channels of the artists it credits. A name says
 * little across scripts (陈奕迅's songs are credited to "Eason Chan"); the
 * channel is the same whatever the name is written as (youtubeMatch.ts).
 */
export interface CreditedSong {
  readonly track: ProbedTrack
  readonly channels: readonly string[]
}

/** An artist as a search lists them: the name as that language writes it, and their channel. */
export interface ListedArtist {
  readonly name: string
  readonly channel: string
}

export class YouTubeMusicLists {
  readonly #api: YouTubeMusicApi

  constructor(logger: Logger, fetchImpl?: FetchLike) {
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
  }

  /** The songs a search finds, or null when YouTube Music did not answer. */
  async songs(query: string): Promise<ProbedTrack[] | null> {
    return (await this.songsBy(query))?.map(song => song.track) ?? null
  }

  /** `songs`, each with the channels of the artists it credits. */
  async songsBy(query: string): Promise<CreditedSong[] | null> {
    const page = await this.#api.post('search', { query, params: SONG_SEARCH_AS_THE_WEB_APP })
    if (!page) return null
    return findAll(page, 'musicResponsiveListItemRenderer')
      .map(item => creditedRow(item, {}))
      .filter((song): song is CreditedSong => song !== null)
  }

  /**
   * The artists a search finds for a name, named as `language` writes them, or
   * null when YouTube Music did not answer. The language matters: asked in
   * English 周杰伦 is "Jay Chou", and asked in Chinese he is 周杰倫, which can
   * be told to be the name that was asked for.
   */
  async artists(name: string, language: string): Promise<ListedArtist[] | null> {
    const page = await this.#api.post(
      'search',
      { query: name, params: ARTIST_SEARCH_AS_THE_WEB_APP },
      { ...WEB_CLIENT, hl: language },
    )
    if (!page) return null
    return findAll(page, 'musicResponsiveListItemRenderer')
      .map(artistRow)
      .filter((artist): artist is ListedArtist => artist !== null)
  }

  /**
   * An album's songs. Its own rows can lead to the wrong recording: where a
   * song has a music video, the album page's row plays the video, and a live
   * album's video carries the stage around the song (セブンティーン's runs
   * 297 s where the track runs 218, the Opening before it included). The
   * album's own playlist, which its play button names, lists the tracks, so
   * the rows are read from there and the rest from the album's page.
   */
  async album(browseId: string): Promise<SongList | null> {
    const page = await this.#api.post('browse', { browseId })
    if (!page) return null
    const audio = audioPlaylistIn(page)
    if (!audio) return null
    const list = await this.#api.post('browse', { browseId: `VL${audio}` })
    return list ? asAlbum(page, list) : null
  }

  /**
   * A playlist's songs. Each row names its own artist, album and cover; the
   * page only names the playlist.
   *
   * An album's own playlist — the `OLAK5uy_…` list a `watch?v=…&list=` link
   * from an album carries — is answered with rows and no header at all. Its
   * rows are the album's tracks, each naming the album it is from; the
   * album's own page has the title, artist, cover and count.
   */
  async playlist(playlistId: string): Promise<SongList | null> {
    const page = await this.#api.post('browse', { browseId: `VL${playlistId}` })
    if (!page) return null
    const header = pageHeader(page)
    if (!header.title) {
      const albumId = albumIdIn(page)
      const album = albumId ? await this.#api.post('browse', { browseId: albumId }) : null
      return album ? asAlbum(album, page) : null
    }
    const tracks = rows(page, {})
    if (tracks.length === 0) return null
    return { title: header.title, tracks, complete: whole(header, tracks) }
  }
}

/** An album: named, credited and counted by its own page, its tracks the rows of its playlist. */
function asAlbum(albumPage: unknown, listPage: unknown): SongList | null {
  const header = pageHeader(albumPage)
  if (!header.title) return null
  const tracks = rows(listPage, {
    artist: header.artist,
    album: header.title,
    thumbnail: header.thumbnail,
  })
  if (tracks.length === 0) return null
  return { title: header.title, tracks, complete: whole(header, tracks) }
}

/** The album's own playlist (`OLAK5uy_…`), as its page's play button names it. */
function audioPlaylistIn(albumPage: unknown): string | null {
  const header =
    findKey(albumPage, 'musicResponsiveHeaderRenderer') ??
    findKey(albumPage, 'musicDetailHeaderRenderer')
  for (const endpoint of findAll(header, 'watchPlaylistEndpoint')) {
    const id = (endpoint as { playlistId?: unknown }).playlistId
    if (typeof id === 'string' && id.startsWith('OLAK5uy_')) return id
  }
  return null
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
  const largest = largestThumbnail(header)
  const counted = /(\d[\d,]*)\s+(song|track)/i.exec(runs(header['secondSubtitle']).join(''))
  return {
    title: runs(header['title']).join('').trim(),
    artist: artistsIn(header['straplineTextOne'] ?? header['subtitle']).join(', '),
    thumbnail: largest !== null ? coverSized(largest) : null,
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

/** The album the page's rows are from, by the first row that names one. */
function albumIdIn(page: unknown): string | null {
  for (const item of findAll(page, 'musicResponsiveListItemRenderer')) {
    for (const column of rowColumns(item)) {
      for (const run of column) {
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

/**
 * One row of a list. The first column is the title; the others read
 * "Artist • Album • 3:45" in a search, or one thing each on an album or a
 * playlist, so the runs are read by where they lead rather than by position —
 * a song by two artists has two artist runs, a single has no album, and an
 * album's rows name neither, which the page does for them.
 */
export function songRow(item: unknown, defaults: RowDefaults = {}): ProbedTrack | null {
  return creditedRow(item, defaults)?.track ?? null
}

/** `songRow`, with the channel each artist's name leads to. */
function creditedRow(item: unknown, defaults: RowDefaults): CreditedSong | null {
  const videoId = rowVideoId(item)
  if (videoId === null) return null

  const columns = rowColumns(item)
  const title = (columns[0] ?? [])
    .map(run => (typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim()
  if (!title) return null

  const artists: string[] = []
  const channels: string[] = []
  let album = ''
  let duration = 0
  const texts = [
    ...columns.slice(1).flat(),
    ...findAll(item, 'musicResponsiveListItemFixedColumnRenderer').flatMap(column =>
      runsOf((column as { text?: unknown }).text),
    ),
  ]
  for (const run of texts) {
    if (typeof run.text !== 'string') continue
    const text = run.text.trim()
    const pageType = pageTypeOf(run)
    if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
      artists.push(text)
      const channel = run.navigationEndpoint?.browseEndpoint?.browseId
      if (typeof channel === 'string') channels.push(channel)
    } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') album = text
    else duration = parseLength(text) ?? duration
  }

  const largest = largestThumbnail(item)

  return {
    track: {
      url: `https://music.youtube.com/watch?v=${videoId}`,
      title,
      artist: artists.length > 0 ? artists.join(', ') : (defaults.artist ?? ''),
      album: album || (defaults.album ?? ''),
      duration,
      thumbnail: largest !== null ? coverSized(largest) : (defaults.thumbnail ?? null),
    },
    channels,
  }
}

/** One row of an artist search: the row itself leads to the artist's page. */
function artistRow(item: unknown): ListedArtist | null {
  const row = item as Parameters<typeof pageTypeOf>[0]
  if (pageTypeOf(row) !== 'MUSIC_PAGE_TYPE_ARTIST') return null
  const channel = row.navigationEndpoint?.browseEndpoint?.browseId
  const name = (rowColumns(item)[0] ?? [])
    .map(run => (typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim()
  return typeof channel === 'string' && name ? { name, channel } : null
}

/**
 * A listing's thumbnail is 120 px. The same address serves any size, so the
 * review's rows and the cover kept with the song ask for one worth keeping.
 */
export function coverSized(url: string): string {
  return url.replace(/=w\d+-h\d+/, '=w544-h544')
}
