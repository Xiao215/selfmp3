import { youtubeVideoId } from '@selfmp3/shared'
import { createSession, describeVideo, downloadAudio, type YtSession } from './download.js'
import type { PoMinter } from './poToken.js'
import type { DeviceFile, YouTubeCore } from './keptSongs.js'
import type { YtFetch } from './transport.js'

/**
 * youtubei.js, ready to describe and download (docs/features/client-download.md):
 * one session, opened the first time it is needed and kept — its BotGuard run
 * is the slow part, and one does for every song after it.
 *
 * In the app this runs inside the sandbox frame (sandbox/frame.ts), never in
 * the page that holds the person's self.mp3 session; the page keeps what it
 * downloads (keptSongs.ts).
 */

/**
 * What a description is cut to, in UTF-8 bytes. It goes in a header
 * (meta.ts), base64'd, and Node takes 16 KiB of headers in all — a proxy in
 * front, 8 KiB a header: 5000 characters of Japanese lyrics were three times
 * that. What is read from it (a release date, a YouTube Music track's
 * credits) is at its start.
 */
const MAX_DESCRIPTION_BYTES = 4000

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
          description: cutToBytes(audio.description, MAX_DESCRIPTION_BYTES),
          title: audio.title.slice(0, 300),
          author: audio.author.slice(0, 300),
          durationSeconds: audio.durationSeconds,
          thumbnail: audio.thumbnail && audio.thumbnail.length <= 2000 ? audio.thumbnail : null,
        },
      }
    },
  }
}

/** `text`, cut at a character so its UTF-8 is at most `max` bytes. */
export function cutToBytes(text: string, max: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= max) return text
  let used = 0
  let out = ''
  for (const character of text) {
    used += encoder.encode(character).length
    if (used > max) break
    out += character
  }
  return out
}
