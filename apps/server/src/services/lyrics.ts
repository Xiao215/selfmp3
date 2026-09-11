import path from 'node:path'
import fsp from 'node:fs/promises'
import { isSynced, LYRIC_EXTENSIONS, type LyricsKind } from '@selfmp3/shared'
import type { StorageDriver } from '../storage/index.js'
import type { Logger } from '../logger.js'
import { APP_VERSION } from '../config.js'

/**
 * Lyrics come from three places, in order of trust:
 *
 *  1. A sidecar file next to the audio (`Artist - Title.lrc`). Yours, editable,
 *     wins over everything.
 *  2. Tags embedded in the audio file itself.
 *  3. lrclib.net, a community database, fetched once and then written to disk
 *     as a sidecar so it is available offline afterwards.
 */

const USER_AGENT = `self.mp3/${APP_VERSION} (personal music library; https://github.com/)`
const LRCLIB = 'https://lrclib.net/api'
const REQUEST_TIMEOUT_MS = 8_000

export interface LyricsResult {
  readonly source: 'sidecar' | 'embedded' | 'remote'
  readonly kind: LyricsKind
  readonly text: string
}

/** Lyrics as lrclib has them, before they are written to disk. */
export interface RemoteLyrics {
  readonly text: string
  readonly synced: boolean
}

/**
 * lrclib's answer when it knows the track has no words. Kept apart from
 * "nothing found" so the song can be remembered as instrumental and not looked
 * up again every time it plays.
 */
export type Instrumental = 'instrumental'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface LrclibRecord {
  syncedLyrics?: string | null
  plainLyrics?: string | null
  instrumental?: boolean
}

export class LyricsService {
  readonly #storage: StorageDriver
  readonly #logger: Logger
  readonly #fetch: FetchLike

  constructor(storage: StorageDriver, logger: Logger, fetchImpl: FetchLike = fetch) {
    this.#storage = storage
    this.#logger = logger.child('lyrics')
    this.#fetch = fetchImpl
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

  /** Write lyrics next to the audio file so they survive and work offline. */
  async writeSidecar(audioKey: string, text: string, synced: boolean): Promise<void> {
    const stem = audioKey.replace(/\.[^.]+$/, '')
    const key = stem + (synced ? '.lrc' : '.txt')
    await this.#storage.write(key, Buffer.from(text, 'utf8'))
  }

  /**
   * Look a track up on lrclib.
   *
   * Tries the exact endpoint first (artist + title + album + duration, which
   * lets the service pick the right version of a song), then falls back to a
   * fuzzy search. Any network failure is swallowed — a song without lyrics is
   * a minor disappointment, not an import failure.
   *
   * Only the exact match is believed when it says a track is instrumental.
   * The fuzzy search happily returns the karaoke version of a song with
   * words, and remembering the original as instrumental would stop it from
   * ever being looked up again.
   */
  async fetchRemote(input: {
    artist: string
    title: string
    album: string
    duration: number
  }): Promise<RemoteLyrics | Instrumental | null> {
    if (!input.title.trim()) return null

    const exact = await this.#exactMatch(input)
    const record = exact ?? (await this.#searchMatch(input))
    if (!record) return null

    if (record.syncedLyrics?.trim()) return { text: record.syncedLyrics, synced: true }
    if (record.plainLyrics?.trim()) return { text: record.plainLyrics, synced: false }
    if (record === exact && record.instrumental === true) return 'instrumental'
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

  async #searchMatch(input: { artist: string; title: string }): Promise<LrclibRecord | null> {
    const query = `${input.artist} ${input.title}`.trim()
    const results = await this.#getJson<LrclibRecord[]>(
      `${LRCLIB}/search?q=${encodeURIComponent(query)}`,
    )
    if (!Array.isArray(results)) return null
    // Prefer a synced result even if it ranks lower than a plain one.
    return (
      results.find(item => item.syncedLyrics?.trim()) ??
      results.find(item => item.plainLyrics?.trim()) ??
      null
    )
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
    audioKey: string,
    embedded: string | null,
    remoteInput: { artist: string; title: string; album: string; duration: number } | null,
  ): Promise<LyricsResult | Instrumental | null> {
    const sidecar = await this.readSidecar(audioKey)
    if (sidecar) return sidecar

    if (embedded?.trim()) {
      return { source: 'embedded', kind: isSynced(embedded) ? 'synced' : 'plain', text: embedded }
    }

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

  /** Where a sidecar would live, for logging. */
  sidecarPathHint(audioKey: string): string {
    return `${path.basename(audioKey).replace(/\.[^.]+$/, '')}.lrc`
  }
}
