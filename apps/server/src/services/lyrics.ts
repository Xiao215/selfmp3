import fsp from 'node:fs/promises'
import { isSynced, LYRIC_EXTENSIONS, youtubeVideoId, type LyricsKind } from '@selfmp3/shared'
import type { StorageDriver } from '../storage/index.js'
import type { Logger } from '../logger.js'
import { USER_AGENT } from '../config.js'
import type { YouTubeMusicLyrics } from './youtubeMusic.js'

/**
 * Lyrics come from four places, in order of trust:
 *
 *  1. A sidecar file next to the audio (`Artist - Title.lrc`). Yours, editable,
 *     wins over everything — while it is here. The cloud pass uploads it and
 *     then lets it go with the audio (docs/SYNC.md), so for most of a library
 *     there is none.
 *  2. Tags embedded in the audio file itself, while the audio is here.
 *  3. The bucket's copy of the words, which is where both of the above end up.
 *  4. The network, fetched once and then written to disk as a sidecar for the
 *     pass to send up: YouTube Music's timed lyrics first (see
 *     youtubeMusic.ts), then lrclib.net, a community database.
 */

const LRCLIB = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000

interface LyricsResult {
  readonly source: 'sidecar' | 'embedded' | 'cloud' | 'remote'
  readonly kind: LyricsKind
  readonly text: string
}

/** What a song is looked up by. */
interface LyricsLookup {
  readonly artist: string
  readonly title: string
  readonly album: string
  readonly duration: number
  /** Where it was imported from; a YouTube link finds its own lyrics. */
  readonly sourceUrl?: string | null
}

/** Lyrics as found online, before they are written to disk. */
interface RemoteLyrics {
  readonly text: string
  readonly synced: boolean
}

/**
 * lrclib's answer when it knows the track has no words. Kept apart from
 * "nothing found" so the song can be remembered as instrumental and not looked
 * up again every time it plays.
 */
type Instrumental = 'instrumental'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface LrclibRecord {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
  /** Seconds: the length of the recording the lyrics were timed against. */
  duration?: number | null
}

/**
 * How far a recording's length may be from the song's for its timings to be
 * trusted. The same song is uploaded at many lengths — the single, the album
 * cut, the music video with its intro — and lyrics timed against another one
 * run early or late the whole way through.
 */
const SYNCED_TOLERANCE_S = 1

/** The words as the bucket holds them for a song, or null when it holds none. */
type FromBucket = (songId: number) => Promise<RemoteLyrics | null>

export class LyricsService {
  readonly #storage: StorageDriver
  readonly #logger: Logger
  readonly #fetch: FetchLike
  readonly #youtubeMusic: YouTubeMusicLyrics | null
  readonly #fromBucket: FromBucket | null

  constructor(
    storage: StorageDriver,
    logger: Logger,
    fetchImpl: FetchLike = fetch,
    youtubeMusic: YouTubeMusicLyrics | null = null,
    fromBucket: FromBucket | null = null,
  ) {
    this.#storage = storage
    this.#logger = logger.child('lyrics')
    this.#fetch = fetchImpl
    this.#youtubeMusic = youtubeMusic
    this.#fromBucket = fromBucket
  }

  /**
   * The words this server can hand over without asking the network: a
   * sidecar still here, or else the bucket's copy. What the search index and
   * the romanization pass read, since both run unattended.
   */
  async stored(songId: number, audioKey: string): Promise<LyricsResult | null> {
    const sidecar = await this.readSidecar(audioKey)
    if (sidecar) return sidecar
    const cloud = await this.#fromBucket?.(songId)
    return cloud
      ? { source: 'cloud', kind: cloud.synced ? 'synced' : 'plain', text: cloud.text }
      : null
  }

  /** Path of an existing sidecar for this audio key, or null. */
  async findSidecar(audioKey: string): Promise<{ key: string; extension: string } | null> {
    const stem = audioKey.replace(/\.[^.]+$/, '')
    for (const extension of LYRIC_EXTENSIONS) {
      const key = stem + extension
      if (await this.#storage.exists(key)) return { key, extension }
    }
    return null
  }

  async readSidecar(audioKey: string): Promise<LyricsResult | null> {
    const sidecar = await this.findSidecar(audioKey)
    if (!sidecar) return null
    try {
      const text = (await this.#storage.read(sidecar.key)).toString('utf8')
      if (!text.trim()) return null
      return { source: 'sidecar', kind: isSynced(text) ? 'synced' : 'plain', text }
    } catch {
      return null
    }
  }

  /**
   * Write lyrics next to the audio file so they survive and work offline.
   * Timed lyrics replace plain ones outright: the `.txt` would never be read
   * again, and a song's folder should say what it has.
   */
  async writeSidecar(audioKey: string, text: string, synced: boolean): Promise<void> {
    const stem = audioKey.replace(/\.[^.]+$/, '')
    const key = stem + (synced ? '.lrc' : '.txt')
    await this.#storage.write(key, Buffer.from(text, 'utf8'))
    if (synced) await this.#storage.delete(`${stem}.txt`).catch(() => undefined)
  }

  /**
   * Look a track up online: YouTube Music, then lrclib.
   *
   * YouTube Music's timed lyrics win whenever it has them for this recording
   * — professionally timed, and for a song imported from YouTube, timed
   * against the very track that was downloaded.
   *
   * On lrclib, tries the exact endpoint first (artist + title + album + duration, which
   * lets the service pick the right version of a song). Timed lyrics from it
   * are taken as they are. Anything less — plain words only, or no match —
   * goes on to the fuzzy search for timed lyrics whose recording is within a
   * second of this one, the closest winning: lrclib's exact answer is often
   * one upload among many, and the untimed one at that. Failing that, plain
   * words, which at least never run early or late. Any network failure is
   * swallowed — a song without lyrics is a minor disappointment, not an
   * import failure.
   *
   * Only the exact match is believed when it says a track is instrumental.
   * The fuzzy search happily returns the karaoke version of a song with
   * words, and remembering the original as instrumental would stop it from
   * ever being looked up again.
   */
  async fetchRemote(input: LyricsLookup): Promise<RemoteLyrics | Instrumental | null> {
    if (!input.title.trim()) return null

    const fromYouTube = await this.#youtubeMusic?.find({
      videoId: youtubeVideoId(input.sourceUrl),
      artist: input.artist,
      title: input.title,
      duration: input.duration,
    })
    if (fromYouTube) return { text: fromYouTube, synced: true }

    const exact = await this.#exactMatch(input)
    if (exact && hasSynced(exact) && isCloseEnough(exact, input.duration, true)) {
      return { text: exact.syncedLyrics, synced: true }
    }
    if (exact?.instrumental === true && !hasSynced(exact) && !hasPlain(exact)) {
      return 'instrumental'
    }

    const found = await this.#search(input)
    const records = exact ? [exact, ...found] : found

    const synced = closestFirst(
      records.filter(record => isCloseEnough(record, input.duration, false)),
      input.duration,
    ).find(hasSynced)
    if (synced) return { text: synced.syncedLyrics, synced: true }

    // The exact match's words first, then the upload nearest in length.
    const plain =
      exact && hasPlain(exact) ? exact : closestFirst(found, input.duration).find(hasPlain)
    if (plain) return { text: plain.plainLyrics, synced: false }
    return null
  }

  async #exactMatch(input: {
    artist: string
    title: string
    album: string
    duration: number
  }): Promise<LrclibRecord | null> {
    if (!input.artist.trim()) return null
    const query = new URLSearchParams({
      artist_name: input.artist,
      track_name: input.title,
    })
    if (input.album.trim()) query.set('album_name', input.album)
    if (input.duration > 0) query.set('duration', String(Math.round(input.duration)))

    return this.#getJson<LrclibRecord>(`${LRCLIB}/get?${query.toString()}`)
  }

  async #search(input: { artist: string; title: string }): Promise<LrclibRecord[]> {
    const query = `${input.artist} ${input.title}`.trim()
    const results = await this.#getJson<LrclibRecord[]>(
      `${LRCLIB}/search?q=${encodeURIComponent(query)}`,
    )
    return Array.isArray(results) ? results : []
  }

  async #getJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.#fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) return null
      return (await response.json()) as T
    } catch (error) {
      this.#logger.debug('lyrics lookup failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Full resolution for one song: sidecar, then embedded tag, then the network
   * (writing the result to disk so the next lookup is local).
   *
   * Pass `remoteInput: null` to stay off the network, for a song already known
   * to be instrumental. Local lyrics still win in that case: if you added a
   * sidecar by hand, the words are there, whatever lrclib thought.
   */
  async resolve(
    songId: number,
    audioKey: string,
    embedded: string | null,
    remoteInput: LyricsLookup | null,
  ): Promise<LyricsResult | Instrumental | null> {
    const sidecar = await this.readSidecar(audioKey)
    if (sidecar) return sidecar

    if (embedded?.trim()) {
      return { source: 'embedded', kind: isSynced(embedded) ? 'synced' : 'plain', text: embedded }
    }

    const cloud = await this.#fromBucket?.(songId)
    if (cloud) return { source: 'cloud', kind: cloud.synced ? 'synced' : 'plain', text: cloud.text }

    if (!remoteInput) return null

    const remote = await this.fetchRemote(remoteInput)
    if (!remote || remote === 'instrumental') return remote

    try {
      await this.writeSidecar(audioKey, remote.text, remote.synced)
    } catch (error) {
      this.#logger.warn('could not save lyrics sidecar', {
        audioKey,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    return {
      source: 'remote',
      kind: remote.synced ? 'synced' : 'plain',
      text: remote.text,
    }
  }

  /** Cheap check used by the scanner: does this song have lyrics at all? */
  async detectKind(audioKey: string, embedded: string | null): Promise<LyricsKind> {
    const sidecar = await this.findSidecar(audioKey)
    if (sidecar) {
      try {
        const text = (await this.#storage.read(sidecar.key)).toString('utf8')
        if (text.trim()) return isSynced(text) ? 'synced' : 'plain'
      } catch {
        // Unreadable sidecar counts as no lyrics.
      }
    }
    if (embedded?.trim()) return isSynced(embedded) ? 'synced' : 'plain'
    return 'none'
  }

  /** Remove a song's sidecar, used when a song is deleted from the library. */
  async deleteSidecar(audioKey: string): Promise<void> {
    const stem = audioKey.replace(/\.[^.]+$/, '')
    for (const extension of LYRIC_EXTENSIONS) {
      const local = this.#storage.localPath(stem + extension)
      if (local) {
        await fsp.rm(local, { force: true }).catch(() => undefined)
      } else {
        await this.#storage.delete(stem + extension).catch(() => undefined)
      }
    }
  }
}

function hasSynced(record: LrclibRecord): record is LrclibRecord & { syncedLyrics: string } {
  return Boolean(record.syncedLyrics?.trim())
}

function hasPlain(record: LrclibRecord): record is LrclibRecord & { plainLyrics: string } {
  return Boolean(record.plainLyrics?.trim())
}

/**
 * Was this record timed against a recording as long as the song? With no
 * length for the song there is nothing to compare, so anything goes. A record
 * with no length of its own is trusted only from the exact endpoint, which
 * matched on length itself.
 */
function isCloseEnough(record: LrclibRecord, duration: number, trustUnknown: boolean): boolean {
  if (duration <= 0) return true
  if (!record.duration) return trustUnknown
  return Math.abs(record.duration - duration) <= SYNCED_TOLERANCE_S
}

/** Nearest in length first; lrclib's own order among equals, and without a length to go by. */
function closestFirst(records: readonly LrclibRecord[], duration: number): LrclibRecord[] {
  if (duration <= 0) return [...records]
  const gap = (record: LrclibRecord): number =>
    record.duration ? Math.abs(record.duration - duration) : Number.POSITIVE_INFINITY
  return [...records].sort((a, b) => gap(a) - gap(b))
}
