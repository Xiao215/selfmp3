import { youtubeVideoId, type ImportDeviceFileMeta } from '@selfmp3/shared'

/**
 * Songs this device downloaded, kept a while (docs/features/client-download.md).
 *
 * Nothing here runs YouTube's code or loads youtubei.js, so the app's page can
 * hold it: what downloads is somewhere else — the sandbox frame
 * (sandbox/frame.ts), or a page of its own in the harness — and this only
 * keeps what it gave back. A song heard in a review is the song imported a
 * moment later, and asking YouTube for it twice would spend two turns on one
 * song; a song asked for while it is still coming waits for that download.
 */

export interface DeviceFile {
  readonly bytes: Uint8Array<ArrayBuffer>
  /** Always `audio/mp4`: only m4a is downloaded, as the server's own downloads prefer. */
  readonly mimeType: 'audio/mp4'
  /** The bytes' SHA-256, hex. */
  readonly sha256: string
  readonly meta: ImportDeviceFileMeta
}

/** What the player says of a video, for a review to show before anything is downloaded. */
export interface VideoFacts {
  readonly title: string
  readonly author: string
  readonly durationSeconds: number
  /** A YouTube Music track's says its song, artists, album and release (musicDescription.ts). */
  readonly description: string
  /** The largest still the player names, or null. */
  readonly thumbnail: string | null
}

/** What downloads: youtubei.js itself (downloader.ts), or the sandbox frame that runs it. */
export interface YouTubeCore {
  describe(url: string): Promise<VideoFacts>
  download(url: string, onProgress: (percent: number) => void): Promise<DeviceFile>
}

interface DeviceDownloader {
  /** What the player says of the video at `url`, without downloading it. */
  describe(url: string): Promise<VideoFacts>
  download(
    url: string,
    options?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<DeviceFile>
  /** Whether the song at `url` is downloaded already, or coming: asking for it costs YouTube nothing. */
  has(url: string): boolean
  /**
   * Once the song at `url` has finished coming, or failed — whoever stopped
   * waiting for it, the download itself goes on until then.
   */
  settled(url: string): Promise<void>
}

/** Songs kept: a review's worth of listening, at a few megabytes each. */
const KEPT_SONGS = 8

export function withKeptSongs(core: YouTubeCore): DeviceDownloader {
  /** Downloads by video, the newest asked for last; one that failed is let go. */
  const kept = new Map<string, Promise<DeviceFile>>()
  /** Who is following each download under way. */
  const progress = new Map<string, Set<(percent: number) => void>>()

  const videoOf = (url: string): string => {
    const videoId = youtubeVideoId(url)
    if (!videoId) throw new Error(`not a YouTube video: ${url}`)
    return videoId
  }

  return {
    describe: url => core.describe(url),

    async download(url, options = {}) {
      const videoId = videoOf(url)
      let song = kept.get(videoId)
      if (song) {
        // Asked for again: it goes to the end of the line, the newest kept.
        kept.delete(videoId)
      } else {
        const fetched = core.download(url, percent => {
          for (const listener of progress.get(videoId) ?? []) listener(percent)
        })
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

    settled(url) {
      const videoId = youtubeVideoId(url)
      const song = videoId === null ? undefined : kept.get(videoId)
      return song
        ? song.then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve()
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
