import { buildLrc, type TimedLine } from '@selfmp3/shared'
import type { Logger } from '../logger.js'

/**
 * Timed lyrics from YouTube Music.
 *
 * YouTube Music shows line-timed lyrics licensed from Musixmatch: timed by
 * people, against the studio recording. For a song imported from YouTube
 * they belong to the very track that was downloaded, which makes them the
 * best source this app has, ahead of lrclib's community uploads.
 *
 * There is no official API. This speaks the private one the YouTube Music
 * apps use, the way ytmusicapi does: `next` on a video names its lyrics, and
 * `browse` on those, asked as the Android app, returns them with timings (the
 * web client only ever gets plain text). It can change without notice, so
 * every failure here is quiet and lrclib is always tried after it.
 */

const API = 'https://music.youtube.com/youtubei/v1/'
const WEB_CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en' }
const ANDROID_CLIENT = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', hl: 'en' }
/** The search's "Songs" filter: studio tracks only, no videos or playlists. */
const SONGS_ONLY = 'EgWKAQIIAWoMEA4QChADEAQQCRAF'
const REQUEST_TIMEOUT_MS = 8_000
/** Search hits worth asking for lyrics, best first. Each costs two requests. */
const MAX_CANDIDATES = 2

/**
 * How far the track's length may be from the file's for its timings to be
 * trusted — the same second as lrclib gets. YouTube Music shows lengths in
 * whole seconds, rounded up (a 248.06 s download shows as 4:09), so a track
 * shown as L seconds is anywhere from L − 1 to L long.
 */
const LENGTH_TOLERANCE_S = 1

/** The one kind of entry whose timings match a download: the studio audio, not a video. */
const AUDIO_TRACK = 'MUSIC_VIDEO_TYPE_ATV'

/** A title naming another cut of the song, which the song itself does not. */
const OTHER_VERSION =
  /\b(?:version|ver\.|remix|live|instrumental|inst\.|acoustic|karaoke|off vocal|cover|sped up|slowed)\b/i

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface YouTubeMusicLookup {
  /** The video the song was downloaded from, when it was. */
  readonly videoId: string | null
  readonly artist: string
  readonly title: string
  /** Seconds, from the file; 0 when unknown. */
  readonly duration: number
}

interface Track {
  readonly videoId: string
  readonly title: string
  readonly artist: string
  readonly audioTrack: boolean
  /** Whole seconds as shown, or null. */
  readonly length: number | null
}

interface WatchInfo {
  readonly track: Track | null
  readonly lyricsId: string | null
}

export class YouTubeMusicLyrics {
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#logger = logger.child('youtube-music')
    this.#fetch = fetchImpl
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

    const response = await this.#post('browse', { browseId: watch.lyricsId }, ANDROID_CLIENT)
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
    const response = await this.#post('next', { videoId, isAudioOnly: true }, WEB_CLIENT)
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
        audioTrack: findKey(renderer, 'musicVideoType') === AUDIO_TRACK,
        length: parseLength(texts('lengthText').join('')),
      },
      lyricsId: lyricsId ?? null,
    }
  }

  /** Studio tracks that are this song, nearest in length first. */
  async #searchSongs(input: YouTubeMusicLookup): Promise<Track[]> {
    const query = `${input.artist} ${input.title}`.trim()
    const response = await this.#post('search', { query, params: SONGS_ONLY }, WEB_CLIENT)
    if (!response) return []

    const tracks: Track[] = []
    for (const item of findAll(response, 'musicResponsiveListItemRenderer')) {
      const videoId = findKey((item as Record<string, unknown>)['playlistItemData'], 'videoId')
      if (typeof videoId !== 'string') continue
      // Column one is the title; column two reads "Artist • Album • 3:27".
      const columns = findAll(item, 'musicResponsiveListItemFlexColumnRenderer').map(column =>
        runs((column as Record<string, unknown>)['text']).join(''),
      )
      const details = (columns[1] ?? '').split(' • ')
      tracks.push({
        videoId,
        title: columns[0] ?? '',
        artist: details[0] ?? '',
        audioTrack: findKey(item, 'musicVideoType') === AUDIO_TRACK,
        length: parseLength(details.at(-1) ?? ''),
      })
    }

    return tracks
      .filter(track => track.audioTrack && isSameSong(track, input) && fits(track, input.duration))
      .sort((a, b) => lengthGap(a, input.duration) - lengthGap(b, input.duration))
      .slice(0, MAX_CANDIDATES)
  }

  async #post(endpoint: string, body: object, client: object): Promise<unknown> {
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
      return (await response.json()) as unknown
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

/** Seconds between the file and the track, allowing for the rounded-up length. */
function lengthGap(track: Track, duration: number): number {
  if (duration <= 0) return 0
  if (track.length === null) return Number.POSITIVE_INFINITY
  if (duration > track.length) return duration - track.length
  if (duration < track.length - 1) return track.length - 1 - duration
  return 0
}

function fits(track: Track, duration: number): boolean {
  return lengthGap(track, duration) <= LENGTH_TOLERANCE_S
}

/**
 * Same title and artist, give or take how each side writes them: YouTube
 * Music may add a romanized title ("オリオン - Orion"), and a local file may
 * list a featured artist. A title naming another cut — "(English Version)",
 * "(Live)" — is another song for lyrics, unless the file's title says so too.
 */
function isSameSong(track: Track, input: YouTubeMusicLookup): boolean {
  const title = normalize(track.title)
  const wanted = normalize(input.title)
  if (!title || !wanted || !(title.includes(wanted) || wanted.includes(title))) return false
  if (OTHER_VERSION.test(track.title) && !OTHER_VERSION.test(input.title)) return false

  const artist = normalize(track.artist)
  const wantedArtist = normalize(input.artist)
  return !wantedArtist || artist.includes(wantedArtist) || wantedArtist.includes(artist)
}

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** "3:27" or "1:02:03" to seconds. */
function parseLength(text: string): number | null {
  if (!/^\d+(?::\d{2}){1,2}$/.test(text.trim())) return null
  return text
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0)
}

/** The text of a `{ runs: [{ text }] }` block. */
function runs(value: unknown): string[] {
  const list = (value as { runs?: unknown } | undefined)?.runs
  if (!Array.isArray(list)) return []
  return list.map(run => (run as { text?: unknown }).text).filter(t => typeof t === 'string')
}

/** Every value under `key`, anywhere in a response. Responses nest deep and move. */
function findAll(value: unknown, key: string, found: unknown[] = []): unknown[] {
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

function findKey(value: unknown, key: string): unknown {
  return findAll(value, key)[0]
}
