import { buildLrc, type TimedLine } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import {
  ANDROID_CLIENT,
  findAll,
  findKey,
  runs,
  WEB_CLIENT,
  YouTubeMusicApi,
  type FetchLike,
} from './youtubeMusicApi.js'
import {
  AUDIO_TRACK,
  fits,
  isSameSong,
  lengthGap,
  parseLength,
  searchSongs,
  type SongLookup,
  type Track,
} from './youtubeMusicSongs.js'

/**
 * Timed lyrics from YouTube Music.
 *
 * YouTube Music shows line-timed lyrics licensed from Musixmatch: timed by
 * people, against the studio recording. For a song imported from YouTube
 * they belong to the very track that was downloaded, which makes them the
 * best source this app has, ahead of lrclib's community uploads.
 *
 * Through the private API the YouTube Music apps use (youtubeMusicApi.ts):
 * `next` on a video names its lyrics, and `browse` on those, asked as the
 * Android app, returns them with timings (the web client only ever gets plain
 * text). It can change without notice, so every failure here is quiet and
 * lrclib is always tried after it.
 */

/** Search hits worth asking for lyrics, best first. Each costs two requests. */
const MAX_CANDIDATES = 2

interface YouTubeMusicLookup extends SongLookup {
  /** The video the song was downloaded from, when it was. */
  readonly videoId: string | null
}

interface WatchInfo {
  readonly track: Track | null
  readonly lyricsId: string | null
}

export class YouTubeMusicLyrics {
  readonly #api: YouTubeMusicApi

  constructor(logger: Logger, fetchImpl?: FetchLike) {
    this.#api = new YouTubeMusicApi(logger, fetchImpl)
  }

  /**
   * Timed lyrics as an LRC document, or null.
   *
   * The song's own video first, when it is the studio track and as long as
   * the file. Otherwise — a file added by hand, or a song imported as its
   * music video, whose intro the timings would not know about — a search for
   * the studio track of the same title and artist, within a second of the
   * file's length.
   */
  async find(input: YouTubeMusicLookup): Promise<string | null> {
    if (input.videoId) {
      const lyrics = await this.#timedLyrics(input.videoId, input)
      if (lyrics) return lyrics
    }

    if (input.duration <= 0 || !input.title.trim()) return null
    for (const track of await this.#searchSongs(input)) {
      if (track.videoId === input.videoId) continue
      const lyrics = await this.#timedLyrics(track.videoId, input)
      if (lyrics) return lyrics
    }
    return null
  }

  async #timedLyrics(videoId: string, input: YouTubeMusicLookup): Promise<string | null> {
    const watch = await this.#watch(videoId)
    if (!watch?.track || !watch.lyricsId) return null
    if (!watch.track.audioTrack || !fits(watch.track, input.duration)) return null

    const response = await this.#api.post('browse', { browseId: watch.lyricsId }, ANDROID_CLIENT)
    const timed = findKey(response, 'timedLyricsData')
    if (!Array.isArray(timed) || timed.length === 0) return null

    const lines: TimedLine[] = []
    let end = 0
    for (const raw of timed as unknown[]) {
      const line = raw as {
        lyricLine?: unknown
        cueRange?: { startTimeMilliseconds?: unknown; endTimeMilliseconds?: unknown }
      }
      const start = Number(line.cueRange?.startTimeMilliseconds)
      if (!Number.isFinite(start)) continue
      lines.push({
        text: typeof line.lyricLine === 'string' ? line.lyricLine : '',
        time: start / 1000,
      })
      end = Math.max(end, Number(line.cueRange?.endTimeMilliseconds) || 0)
    }
    if (lines.length === 0) return null
    // Where the last line ends, so it is not still lit through the outro.
    if (end / 1000 > (lines.at(-1)?.time ?? 0)) lines.push({ text: '', time: end / 1000 })

    return buildLrc(lines, { title: watch.track.title, artist: watch.track.artist })
  }

  /** The entry YouTube Music plays for a video, and the id of its lyrics. */
  async #watch(videoId: string): Promise<WatchInfo | null> {
    const response = await this.#api.post('next', { videoId, isAudioOnly: true }, WEB_CLIENT)
    if (!response) return null

    const renderer = findAll(response, 'playlistPanelVideoRenderer').find(
      item => (item as { videoId?: unknown }).videoId === videoId,
    )
    const lyricsId = findAll(response, 'browseEndpoint')
      .map(endpoint => (endpoint as { browseId?: unknown }).browseId)
      .find((id): id is string => typeof id === 'string' && id.startsWith('MPLY'))

    if (!renderer) return { track: null, lyricsId: lyricsId ?? null }
    const texts = (key: string) => runs((renderer as Record<string, unknown>)[key])
    return {
      track: {
        videoId,
        title: texts('title').join(''),
        artist: texts('longBylineText').join('').split(' • ')[0] ?? '',
        artistChannelId: null,
        audioTrack: findKey(renderer, 'musicVideoType') === AUDIO_TRACK,
        length: parseLength(texts('lengthText').join('')),
      },
      lyricsId: lyricsId ?? null,
    }
  }

  /** Studio tracks that are this song, nearest in length first. */
  async #searchSongs(input: YouTubeMusicLookup): Promise<Track[]> {
    const tracks = (await searchSongs(this.#api, input)) ?? []
    return tracks
      .filter(track => track.audioTrack && isSameSong(track, input) && fits(track, input.duration))
      .sort((a, b) => lengthGap(a, input.duration) - lengthGap(b, input.duration))
      .slice(0, MAX_CANDIDATES)
  }
}
