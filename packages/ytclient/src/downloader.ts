import { bytesToBase64, youtubeVideoId, type ImportDeviceFileMeta } from '@selfmp3/shared'
import {
  createSession,
  describeVideo,
  downloadAudio,
  type VideoFacts,
  type YtSession,
} from './download.js'
import type { YtFetch } from './transport.js'

/**
 * Songs downloaded on this device (docs/features/client-download.md): one
 * session, opened the first time it is needed and kept — its BotGuard run is
 * the slow part, and one does for every song after it.
 *
 * What it downloads it keeps, for a while: a song heard in a review is the
 * song imported a moment later, and asking YouTube for it twice would spend
 * two turns on one song. A song asked for while it is still coming waits for
 * the download already under way.
 */

export interface DeviceFile {
  readonly bytes: Uint8Array<ArrayBuffer>
  /** Always `audio/mp4`: only m4a is downloaded, as the server's own downloads prefer. */
  readonly mimeType: 'audio/mp4'
  /** The bytes' SHA-256, hex. */
  readonly sha256: string
  readonly meta: ImportDeviceFileMeta
}

export interface DeviceDownloader {
  /** What the player says of the video at `url`, without downloading it. */
  describe(url: string): Promise<VideoFacts>
  download(
    url: string,
    options?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<DeviceFile>
  /** Whether the song at `url` is downloaded already, or coming: asking for it costs YouTube nothing. */
  has(url: string): boolean
}

/** What a description is cut to, as the server's file route takes it. */
const MAX_DESCRIPTION = 5000

/** Songs kept: a review's worth of listening, at a few megabytes each. */
const KEPT_SONGS = 8

export function createDeviceDownloader(fetch: YtFetch): DeviceDownloader {
  let session: Promise<YtSession> | null = null
  const open = (): Promise<YtSession> => {
    // A session that failed to open is not kept: the next song tries again.
    session ??= createSession(fetch).catch((error: unknown) => {
      session = null
      throw error
    })
    return session
  }

  /** Downloads by video, the newest asked for last; one that failed is let go. */
  const kept = new Map<string, Promise<DeviceFile>>()
  /** Who is following each download under way. */
  const progress = new Map<string, Set<(percent: number) => void>>()

  const fetchSong = async (videoId: string): Promise<DeviceFile> => {
    const audio = await downloadAudio(await open(), videoId, {
      onProgress: (received, total) => {
        for (const listener of progress.get(videoId) ?? []) listener((received / total) * 100)
      },
    })
    if (!audio.mimeType.startsWith('audio/mp4')) {
      throw new Error(`YouTube gave ${audio.mimeType}, and only m4a is taken`)
    }
    const digest = await crypto.subtle.digest('SHA-256', audio.bytes)
    return {
      bytes: audio.bytes,
      mimeType: 'audio/mp4',
      sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      meta: {
        description: audio.description.slice(0, MAX_DESCRIPTION),
        title: audio.title.slice(0, 300),
        author: audio.author.slice(0, 300),
        durationSeconds: audio.durationSeconds,
      },
    }
  }

  const videoOf = (url: string): string => {
    const videoId = youtubeVideoId(url)
    if (!videoId) throw new Error(`not a YouTube video: ${url}`)
    return videoId
  }

  return {
    async describe(url) {
      return describeVideo(await open(), videoOf(url))
    },

    async download(url, options = {}) {
      const videoId = videoOf(url)
      let song = kept.get(videoId)
      if (song) {
        // Asked for again: it goes to the end of the line, the newest kept.
        kept.delete(videoId)
      } else {
        const fetched = fetchSong(videoId)
        fetched.catch(() => {
          if (kept.get(videoId) === fetched) kept.delete(videoId)
        })
        song = fetched
      }
      kept.set(videoId, song)
      while (kept.size > KEPT_SONGS) {
        const oldest = kept.keys().next().value
        if (oldest === undefined) break
        kept.delete(oldest)
      }

      // A caller that stops waiting stops only its own wait: someone else may be waiting too.
      const listener = options.onProgress
      if (listener) {
        const listeners = progress.get(videoId) ?? new Set()
        listeners.add(listener)
        progress.set(videoId, listeners)
      }
      try {
        return await abortable(song, options.signal)
      } finally {
        if (listener) progress.get(videoId)?.delete(listener)
      }
    },

    has(url) {
      const videoId = youtubeVideoId(url)
      return videoId !== null && kept.has(videoId)
    },
  }
}

/** `promise`, or a rejection the moment `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** The meta header's value: base64url JSON, as the server's file route reads it. */
export function metaHeader(meta: ImportDeviceFileMeta): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(meta)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
