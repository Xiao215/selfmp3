import {
  IMPORT_META_HEADER,
  IMPORT_SHA256_HEADER,
  ThrottleStateSchema,
  youtubeVideoId,
  type ThrottleState,
} from '@selfmp3/shared'
import type { DeviceFile } from '@/features/import/deviceImports.model'
import { noteRefusal, takeTurn, type DeviceYouTube } from '@/features/import/devicePreview.model'
import { appPath } from './appPath'

/**
 * Downloading a song in this tab (docs/features/client-download.md): the
 * self.mp3 extension carries the requests to YouTube, and youtubei.js runs in
 * the sandbox frame (`public/yt-sandbox.html`), never in this page — YouTube's
 * player script and BotGuard are code YouTube sends, and this page holds the
 * person's self.mp3 session. Asked once whether the extension answers; a tab
 * without it imports as it always has, through the server.
 *
 * The installed Mac app draws this same page, but from `app://selfmp3`, which
 * the extension does not talk to: it finds no extension and goes through the
 * server too.
 */
let downloader: Promise<DeviceYouTube | null> | null = null
/** When the last look found no way to YouTube, so the next look can wait a while. */
let missedAt = 0
/** Why the last look found none, said once until the reason changes. */
let missedWhy = ''

/**
 * How long a look that found no way to YouTube is believed. A way found is
 * kept for good; one missed is looked for again after this, so an extension
 * that was asleep, turned off and on again, or slow to answer is found
 * without a reload. One installed after this page was opened is not: Chrome
 * gives a page its `chrome.runtime` as it loads, and only a reload brings it.
 */
const LOOK_AGAIN_MS = 30_000

export function deviceDownloader(): Promise<DeviceYouTube | null> {
  if (downloader && missedAt > 0 && Date.now() - missedAt > LOOK_AGAIN_MS) downloader = null
  downloader ??= (async () => {
    const without = (why: string): null => {
      missedAt = Date.now()
      // Said once, so a person wondering why the server downloads can find out.
      if (why !== missedWhy)
        console.warn(`[device import] songs are downloaded by the server: ${why}`)
      missedWhy = why
      return null
    }
    try {
      const { carrierAnswers, extensionFetch, openSandbox, withKeptSongs } =
        await import('@selfmp3/ytclient/host')
      const fetch = extensionFetch()
      if (!fetch) return without('this browser has no self.mp3 extension to ask YouTube through')
      if (!(await carrierAnswers(fetch))) return without('the self.mp3 extension did not answer')
      const found = withKeptSongs(await openSandbox({ src: appPath('yt-sandbox.html'), fetch }))
      missedAt = 0
      missedWhy = ''
      return found
    } catch (error) {
      return without(error instanceof Error ? error.message : String(error))
    }
  })()
  return downloader
}

/**
 * The songs heard here, as addresses the page's audio can play: one per
 * video, made once and let go when the downloader lets the song go, so a song
 * played twice is downloaded once — and imported without being downloaded
 * again (downloader.ts keeps the bytes).
 */
const listenUrls = new Map<string, string>()
const KEPT_LISTENS = 8

/**
 * A review's song, to play from this tab's own download (docs/features/client-download.md),
 * or null for the server's listen — no extension, no turn at YouTube to
 * spare, or a download that failed.
 */
export async function deviceListenUrl(url: string): Promise<string | null> {
  const videoId = youtubeVideoId(url)
  const youtube = videoId ? await deviceDownloader() : null
  if (!videoId || !youtube) return null
  const kept = listenUrls.get(videoId)
  if (kept && youtube.has(url)) return kept
  // The downloader let the song go since: so does its address, and it comes again.
  if (kept) {
    listenUrls.delete(videoId)
    URL.revokeObjectURL(kept)
  }
  if (!youtube.has(url) && !takeTurn(deviceBudget, Date.now())) return null
  try {
    // Nobody stops a listen's download: an import may be waiting on the same song.
    const file = await youtube.download(url, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })
    const made = URL.createObjectURL(new Blob([file.bytes], { type: 'audio/mp4' }))
    listenUrls.set(videoId, made)
    while (listenUrls.size > KEPT_LISTENS) {
      const [oldest, address] = listenUrls.entries().next().value ?? []
      if (oldest === undefined || address === undefined) break
      listenUrls.delete(oldest)
      URL.revokeObjectURL(address)
    }
    return made
  } catch (error) {
    noteRefusal(deviceBudget, Date.now(), error)
    console.warn('[device import] the server plays this one instead:', error)
    return null
  }
}

/** The file, as the body itself, described in the two headers the server reads. */
export async function uploadDeviceFile(
  target: { url: string; headers: Record<string, string> },
  file: DeviceFile,
): Promise<{ status: number; message: string }> {
  const { metaHeader } = await import('@selfmp3/ytclient/host')
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: {
      ...target.headers,
      'Content-Type': 'audio/mp4',
      [IMPORT_SHA256_HEADER]: file.sha256,
      [IMPORT_META_HEADER]: metaHeader(file.meta),
    },
    body: file.bytes,
  })
  const answer = (await response.json().catch(() => null)) as { error?: unknown } | null
  return {
    status: response.status,
    message: typeof answer?.error === 'string' ? answer.error : '',
  }
}

/**
 * This tab's budget at YouTube (ytBudget.ts), kept in localStorage: an
 * address's standing with YouTube outlasts a reload, and so should the
 * bucket that keeps it in check.
 */
const BUDGET_KEY = 'selfmp3.youtube-budget'
export const deviceBudget = {
  get: (): ThrottleState | null => {
    try {
      const parsed = ThrottleStateSchema.safeParse(
        JSON.parse(localStorage.getItem(BUDGET_KEY) ?? 'null'),
      )
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  },
  save: (state: ThrottleState): void => {
    try {
      localStorage.setItem(BUDGET_KEY, JSON.stringify(state))
    } catch {
      // Storage full or refused: the bucket lasts as long as the tab.
    }
  },
}
