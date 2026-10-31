import {
  bytesToBase64,
  IMPORT_META_HEADER,
  IMPORT_SHA256_HEADER,
  ThrottleStateSchema,
  youtubeVideoId,
  type ImportDeviceFileMeta,
  type ThrottleState,
} from '@selfmp3/shared'
import type { DeviceFile } from '@/features/import/deviceImports.model'
import { noteRefusal, takeTurn, type DeviceYouTube } from '@/features/import/devicePreview.model'
import { prefs } from './prefs'

/**
 * What the two ports of downloading on this device (deviceDownloads.ts and
 * deviceDownloads.web.ts) have in common: the budget at YouTube, the upload,
 * and a review's listen — all but where a heard song is kept, which each
 * port says.
 */

/**
 * This device's budget at YouTube (ytBudget.ts), kept with its other small
 * things (prefs.ts): its standing with YouTube outlasts a reload, and so
 * should the bucket that keeps it in check.
 */
const BUDGET_KEY = 'youtube-budget'
export const deviceBudget = {
  get: (): ThrottleState | null => {
    try {
      const parsed = ThrottleStateSchema.safeParse(JSON.parse(prefs.get(BUDGET_KEY) ?? 'null'))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  },
  save: (state: ThrottleState): void => {
    prefs.set(BUDGET_KEY, JSON.stringify(state))
  },
}

/** How long sending one song may take: a few megabytes, on the slowest connection worth waiting for. */
const UPLOAD_MS = 5 * 60_000

/** The meta header's value: base64url JSON, as the server's file route reads it. */
function metaHeader(meta: ImportDeviceFileMeta): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(meta)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/** The file, as the body itself, described in the two headers the server reads. */
export async function uploadDeviceFile(
  target: { url: string; headers: Record<string, string> },
  file: DeviceFile,
): Promise<{ status: number; message: string }> {
  // A send that stalls is given up on: the device's whole queue waits on it.
  const stop = new AbortController()
  const timer = setTimeout(
    () => stop.abort(new Error('the server did not take the file in time')),
    UPLOAD_MS,
  )
  try {
    const response = await fetch(target.url, {
      signal: stop.signal,
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
  } finally {
    clearTimeout(timer)
  }
}

/** Where a port keeps the songs heard here, as something its player can open. */
export interface ListenStore<Kept> {
  /** Keep a song's bytes, as the address to play. */
  keep(videoId: string, bytes: Uint8Array<ArrayBuffer>): Kept
  address(kept: Kept): string
  /** Whether what was kept is still there: a phone's cache may have been cleared. */
  usable(kept: Kept): boolean
  drop(kept: Kept): void
}

/** Songs heard and kept: a review's worth of listening, as the downloader keeps them. */
const KEPT_LISTENS = 8

/**
 * A review's listen from this device's own download (docs/features/client-download.md),
 * or null for the server's — no downloader, no turn at YouTube to spare, or a
 * download that failed. One kept per video, made once and let go when the
 * downloader lets the song go, so a song played twice is downloaded once —
 * and imported without being downloaded again.
 */
export function listenFromDevice<Kept>(
  downloader: () => Promise<DeviceYouTube | null>,
  store: ListenStore<Kept>,
): (url: string) => Promise<string | null> {
  const heard = new Map<string, Kept>()
  const forget = (videoId: string): void => {
    const kept = heard.get(videoId)
    heard.delete(videoId)
    if (kept !== undefined) store.drop(kept)
  }
  return async url => {
    const videoId = youtubeVideoId(url)
    const youtube = videoId ? await downloader() : null
    if (!videoId || !youtube) return null
    const kept = heard.get(videoId)
    if (kept !== undefined && store.usable(kept) && youtube.has(url)) return store.address(kept)
    // The downloader let the song go since: so does what was kept of it, and it comes again.
    if (kept !== undefined) forget(videoId)
    if (!youtube.has(url) && !takeTurn(deviceBudget, Date.now())) return null
    try {
      // Nobody stops a listen's download: an import may be waiting on the same song.
      const song = await youtube.download(url)
      const made = store.keep(videoId, song.bytes)
      heard.set(videoId, made)
      while (heard.size > KEPT_LISTENS) {
        const oldest = heard.keys().next().value
        if (oldest === undefined) break
        forget(oldest)
      }
      return store.address(made)
    } catch (error) {
      noteRefusal(deviceBudget, Date.now(), error)
      console.warn('[device import] the server plays this one instead:', error)
      return null
    }
  }
}
