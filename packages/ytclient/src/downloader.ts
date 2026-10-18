import { youtubeVideoId } from '@selfmp3/shared'
import { createSession, describeVideo, downloadAudio, type YtSession } from './download.js'
import type { PoMinter } from './poToken.js'
import {
  withKeptSongs,
  type DeviceDownloader,
  type DeviceFile,
  type YouTubeCore,
} from './keptSongs.js'
import type { YtFetch } from './transport.js'

/**
 * youtubei.js, ready to describe and download (docs/features/client-download.md):
 * one session, opened the first time it is needed and kept — its BotGuard run
 * is the slow part, and one does for every song after it.
 *
 * In the app this runs inside the sandbox frame (sandbox/frame.ts), never in
 * the page that holds the person's self.mp3 session; the harness, a page of
 * its own, runs it directly.
 */

/** What a description is cut to, as the server's file route takes it. */
const MAX_DESCRIPTION = 5000

export function createYouTubeCore(
  fetch: YtFetch,
  options: { minter?: Pick<PoMinter, 'mint'> } = {},
): YouTubeCore {
  let session: Promise<YtSession> | null = null
  const open = (): Promise<YtSession> => {
    // A session that failed to open is not kept: the next song tries again.
    session ??= createSession(fetch, options).catch((error: unknown) => {
      session = null
      throw error
    })
    return session
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

    async download(url, onProgress): Promise<DeviceFile> {
      const audio = await downloadAudio(await open(), videoOf(url), {
        onProgress: (received, total) => onProgress((received / total) * 100),
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

/** youtubei.js with the songs it downloads kept: the harness's whole downloader. */
export function createDeviceDownloader(fetch: YtFetch): DeviceDownloader {
  return withKeptSongs(createYouTubeCore(fetch))
}
