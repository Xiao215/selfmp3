import { bytesToBase64, youtubeVideoId, type ImportDeviceFileMeta } from '@selfmp3/shared'
import { createSession, downloadAudio, type YtSession } from './download.js'
import type { YtFetch } from './transport.js'

/**
 * Songs downloaded on this device, for the server to add
 * (docs/features/client-download.md): one session, opened the first time it
 * is needed and kept — its BotGuard run is the slow part, and one does for
 * every song after it — and each song handed back as what the server's file
 * route takes.
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
  download(
    url: string,
    options?: { onProgress?: (percent: number) => void; signal?: AbortSignal },
  ): Promise<DeviceFile>
}

/** What a description is cut to, as the server's file route takes it. */
const MAX_DESCRIPTION = 5000

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

  return {
    async download(url, options = {}) {
      const videoId = youtubeVideoId(url)
      if (!videoId) throw new Error(`not a YouTube video: ${url}`)
      const audio = await downloadAudio(await open(), videoId, {
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: (received, total) => options.onProgress?.((received / total) * 100),
      })
      if (!audio.mimeType.startsWith('audio/mp4')) {
        throw new Error(`YouTube gave ${audio.mimeType}, and only m4a is taken`)
      }
      const digest = await crypto.subtle.digest('SHA-256', audio.bytes)
      return {
        bytes: audio.bytes,
        mimeType: 'audio/mp4',
        sha256: [...new Uint8Array(digest)]
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join(''),
        meta: {
          description: audio.description.slice(0, MAX_DESCRIPTION),
          title: audio.title.slice(0, 300),
          author: audio.author.slice(0, 300),
          durationSeconds: audio.durationSeconds,
        },
      }
    },
  }
}

/** The meta header's value: base64url JSON, as the server's file route reads it. */
export function metaHeader(meta: ImportDeviceFileMeta): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(meta)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
