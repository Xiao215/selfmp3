import { bytesToBase64 } from '@selfmp3/shared'
import { createYouTubeCore } from '../downloader.js'
import {
  WEBVIEW_CHUNK_BYTES,
  WEBVIEW_RECEIVE,
  type AppMessage,
  type PageMessage,
  type WebViewBridge,
} from './protocol.js'

/**
 * The phone's YouTube page (protocol.ts): youtubei.js, the player script and
 * BotGuard, in a WebView at YouTube's own address. Bundled on its own into the
 * app's `public/yt-webview.js`, which the phone loads from the web app's
 * address — so a change YouTube makes is met by publishing the web app, not
 * by a new build of the phone's.
 *
 * Its requests are the page's own: to `www.youtube.com` they are the page
 * asking its own site, and the media and BotGuard's servers answer YouTube's
 * address as they answer YouTube's player. BotGuard runs here too: the page
 * is at the address its verdict is about, which a sandboxed frame is not.
 */

declare global {
  interface Window {
    ReactNativeWebView?: WebViewBridge
    [WEBVIEW_RECEIVE]?: (message: AppMessage) => void
  }
}

const bridge = window.ReactNativeWebView
const send = (message: PageMessage): void => {
  bridge?.postMessage(JSON.stringify(message))
}

// Its own fetch: nothing is forwarded, and BotGuard runs here as the session opens (download.ts).
const youtube = createYouTubeCore((input, init) => fetch(input, init))

async function answer(message: AppMessage): Promise<void> {
  const { id } = message
  try {
    if (message.kind === 'describe') {
      send({ kind: 'described', id, facts: await youtube.describe(message.url) })
      return
    }
    const file = await youtube.download(message.url, percent => {
      send({ kind: 'progress', id, percent })
    })
    for (let at = 0; at < file.bytes.length; at += WEBVIEW_CHUNK_BYTES) {
      const data = bytesToBase64(file.bytes.subarray(at, at + WEBVIEW_CHUNK_BYTES))
      send({ kind: 'chunk', id, data })
    }
    send({ kind: 'downloaded', id, size: file.bytes.length, sha256: file.sha256, meta: file.meta })
  } catch (error) {
    send({ kind: 'failed', id, message: error instanceof Error ? error.message : String(error) })
  }
}

window[WEBVIEW_RECEIVE] = message => {
  if (message.kind === 'describe' || message.kind === 'download') void answer(message)
}

send({ kind: 'ready' })
