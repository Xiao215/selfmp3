import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import { DEFAULT_APP_URL } from '@selfmp3/shared'
import {
  createWebViewCore,
  WEBVIEW_RECEIVE,
  withKeptSongs,
  type WebViewCore,
} from '@selfmp3/ytclient/phone'
import type { DeviceYouTube } from '@/features/import/devicePreview.model'
import { createValueStore } from '@/state/valueStore.model'
import { listenFromDevice } from './deviceShared'

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
    // A page that was ready and loads again has dropped what it was asked: it is lost, and opened afresh.
    if (downloader) {
      youtubePage.lost('the YouTube page loaded again')
      return
    }
    inject = run
    if (readyTimer) return
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

/** The songs heard here, kept as files in the cache, which the preview's player opens. */
export const deviceListenUrl = listenFromDevice<File>(deviceDownloader, {
  keep: (videoId, bytes) => {
    const file = new File(Paths.cache, `listen-${videoId}.m4a`)
    file.write(bytes)
    return file
  },
  address: file => file.uri,
  usable: file => file.exists,
  drop: file => {
    try {
      if (file.exists) file.delete()
    } catch {
      // Gone already, or the cache was cleared: either way it is not kept.
    }
  },
})

export { deviceBudget, uploadDeviceFile } from './deviceShared'

/** Settings' card for this: on a phone, always — there is nothing to install. */
export const downloadsHere = {
  available,
  title: 'On this device',
  place: 'device',
  hint: 'YouTube songs are looked up, heard and downloaded on this device, and your server adds them.',
}
