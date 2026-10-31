import type { ImportDeviceFileMeta } from '@selfmp3/shared'
import type { VideoFacts } from '../keptSongs.js'

/**
 * What the phone app and its YouTube page say to each other
 * (docs/features/client-download.md, "On a phone").
 *
 * The page is a WebView the app keeps out of sight, its document given
 * YouTube's own address (`https://www.youtube.com/`), so youtubei.js, the
 * player script and BotGuard run where YouTube's own page would and ask
 * YouTube as YouTube's page does — no extension, no carrier, nothing to
 * forward. It is a browser of its own: the app's JavaScript, and the
 * person's self.mp3 session in it, are not there to be reached.
 *
 * A WebView passes strings, so every message is JSON, and a file's bytes come
 * back as base64 in chunks of at most `WEBVIEW_CHUNK_BYTES`, then the end.
 */

/** Bytes per chunk of a file: a few hundred kilobytes a message, a song in a dozen or so. */
export const WEBVIEW_CHUNK_BYTES = 256 * 1024

/** The app to the page. */
export type AppMessage =
  | { readonly kind: 'describe'; readonly id: number; readonly url: string }
  | { readonly kind: 'download'; readonly id: number; readonly url: string }

/** The page to the app. */
export type PageMessage =
  | { readonly kind: 'ready' }
  | { readonly kind: 'progress'; readonly id: number; readonly percent: number }
  | { readonly kind: 'described'; readonly id: number; readonly facts: VideoFacts }
  | { readonly kind: 'chunk'; readonly id: number; readonly data: string }
  | {
      readonly kind: 'downloaded'
      readonly id: number
      readonly size: number
      readonly sha256: string
      readonly meta: ImportDeviceFileMeta
    }
  | { readonly kind: 'failed'; readonly id: number; readonly message: string }

/** What the page is given to talk back with: the WebView's own bridge. */
export interface WebViewBridge {
  postMessage(message: string): void
}

/** The name the page answers app messages under: `injectJavaScript` calls it. */
export const WEBVIEW_RECEIVE = '__selfmp3Receive'
