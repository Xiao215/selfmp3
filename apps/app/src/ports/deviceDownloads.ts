import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import {
  DEFAULT_APP_URL,
  IMPORT_META_HEADER,
  IMPORT_SHA256_HEADER,
  ThrottleStateSchema,
  youtubeVideoId,
  type ThrottleState,
} from '@selfmp3/shared'
import {
  createWebViewCore,
  metaHeader,
  WEBVIEW_RECEIVE,
  withKeptSongs,
  type WebViewCore,
} from '@selfmp3/ytclient/phone'
import type { DeviceFile } from '@/features/import/deviceImports.model'
import { noteRefusal, takeTurn, type DeviceYouTube } from '@/features/import/devicePreview.model'
import { createValueStore } from '@/state/valueStore.model'
import { prefs } from './prefs'

/**
 * Downloading a song on this phone instead of on the server
 * (docs/features/client-download.md, "On a phone").
 *
 * A phone needs no extension: it is not a web page, and nothing stops it
 * asking YouTube itself. youtubei.js, YouTube's player script and BotGuard run
 * in a WebView kept out of sight (`YouTubePage`, ports/youtubePage.tsx), its
 * page given YouTube's own address, so it asks YouTube as YouTube's page does.
 * The app's JavaScript — and the person's self.mp3 session in it — is not in
 * that WebView; the page is told what to describe or download, and sends back
 * the facts or the file. Its script comes from the web app's address
 * (`public/yt-webview.js`), so it is brought up to date as the web app is, without a
 * new build of the phone's.
 *
 * The page is opened the first time it is needed, not when the app starts:
 * BotGuard's run is a few seconds of a phone's time, and most launches import
 * nothing.
 */

/** What the phone's page loads: the web app's build of packages/ytclient's webview/page.ts. */
const PAGE_SCRIPT = `${DEFAULT_APP_URL}/yt-webview.js`

/** The page the WebView shows: nothing but its script, at YouTube's address. */
export const YOUTUBE_PAGE = {
  html: `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${PAGE_SCRIPT}"></script></body></html>`,
  baseUrl: 'https://www.youtube.com/',
}

/** How long a page may take, from starting to load, to say it is ready. */
const READY_MS = 30_000

/** How long a page that did not come up is believed, before it is tried again. */
const LOOK_AGAIN_MS = 60_000

const available = Platform.OS === 'ios' || Platform.OS === 'android'

/** Whether `YouTubePage` should hold a WebView: once anything has asked for one. */
export const youtubePageWanted = createValueStore(false)

/** The page being opened, until it says it is ready or is lost. */
let current: WebViewCore | null = null
let inject: ((script: string) => void) | null = null
let readyTimer: ReturnType<typeof setTimeout> | null = null
/** The page, once it said it was ready. */
let downloader: DeviceYouTube | null = null
let missedAt = 0

/** What `YouTubePage` calls as its WebView comes and goes. */
export const youtubePage = {
  /** The WebView is loading: how to run a line in its page. Its time to say it is ready starts. */
  connect(run: (script: string) => void): void {
    inject = run
    if (readyTimer || downloader) return
    readyTimer = setTimeout(() => youtubePage.lost('the YouTube page did not load'), READY_MS)
  },
  receive(raw: string): void {
    current?.receive(raw)
  },
  /** The page went — its process ended, or it never loaded. The next ask, a while on, opens another. */
  lost(reason: string): void {
    if (!downloader) {
      missedAt = Date.now()
      console.warn('[device import] songs are downloaded by the server:', reason)
    }
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
    current?.lost(reason)
    current = null
    inject = null
    downloader = null
    youtubePageWanted.set(false)
  },
}

/**
 * Start opening the page, if it is not open or opening, so it is ready by
 * the time a song is wanted: the Import screen calls this as it opens.
 */
export function warmDeviceDownloads(): void {
  if (!available || current) return
  if (missedAt > 0 && Date.now() - missedAt < LOOK_AGAIN_MS) return
  const core = createWebViewCore(message => {
    // JSON is a JavaScript expression: the message goes in as one, and the page's function takes it.
    inject?.(`window.${WEBVIEW_RECEIVE}(${JSON.stringify(message)});true;`)
  })
  current = core
  core.ready.then(
    () => {
      if (current !== core) return
      if (readyTimer) clearTimeout(readyTimer)
      readyTimer = null
      missedAt = 0
      downloader = withKeptSongs(core)
    },
    () => undefined,
  )
  youtubePageWanted.set(true)
}

/**
 * The page, if it is ready now. Never waited for: a person looking a link up
 * or pressing Import is not kept waiting on a page still loading — the server
 * takes that one, and the page is ready for the next.
 */
export function deviceDownloader(): Promise<DeviceYouTube | null> {
  warmDeviceDownloads()
  return Promise.resolve(downloader)
}

/**
 * The songs heard here, as files the preview's player can open: one per
 * video, kept as long as the downloader keeps the song, so a song played
 * twice is downloaded once — and imported without being downloaded again.
 */
const listenFiles = new Map<string, File>()
const KEPT_LISTENS = 8

/**
 * A review's song, to play from this phone's own download, or null for the
 * server's listen: no page, no turn at YouTube to spare, or a download that
 * failed.
 */
export async function deviceListenUrl(url: string): Promise<string | null> {
  const videoId = youtubeVideoId(url)
  const youtube = videoId ? await deviceDownloader() : null
  if (!videoId || !youtube) return null
  const kept = listenFiles.get(videoId)
  if (kept?.exists && youtube.has(url)) return kept.uri
  if (kept) forget(videoId)
  if (!youtube.has(url) && !takeTurn(deviceBudget, Date.now())) return null
  try {
    // Nobody stops a listen's download: an import may be waiting on the same song.
    const song = await youtube.download(url, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })
    const file = new File(Paths.cache, `listen-${videoId}.m4a`)
    file.write(song.bytes)
    listenFiles.set(videoId, file)
    while (listenFiles.size > KEPT_LISTENS) {
      const oldest = listenFiles.keys().next().value
      if (oldest === undefined) break
      forget(oldest)
    }
    return file.uri
  } catch (error) {
    noteRefusal(deviceBudget, Date.now(), error)
    console.warn('[device import] the server plays this one instead:', error)
    return null
  }
}

function forget(videoId: string): void {
  const file = listenFiles.get(videoId)
  listenFiles.delete(videoId)
  try {
    if (file?.exists) file.delete()
  } catch {
    // Gone already, or the cache was cleared: either way it is not kept.
  }
}

/** The file, as the body itself, described in the two headers the server reads. */
export async function uploadDeviceFile(
  target: { url: string; headers: Record<string, string> },
  file: DeviceFile,
): Promise<{ status: number; message: string }> {
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
 * This phone's budget at YouTube (ytBudget.ts), kept with its other small
 * things (prefs.ts): its standing with YouTube outlasts the app being closed.
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

/** Settings' card for this: on a phone, always — there is nothing to install. */
export const downloadsHere = {
  available,
  title: 'On this device',
  place: 'device',
  hint: 'YouTube songs are looked up, heard and downloaded on this device, and your server adds them.',
}
