import { messageOf } from '@selfmp3/shared'
import type { DeviceYouTube } from '@/features/import/devicePreview.model'
import { appPath } from './appPath'
import { listenFromDevice } from './deviceShared'
import { installedApp } from './install'

/**
 * Downloading a song in this tab (docs/features/client-download.md): the
 * self.mp3 extension carries the requests to YouTube, and youtubei.js and
 * YouTube's player script run in the sandbox frame (`public/yt-sandbox.html`),
 * not in this page, which holds the person's self.mp3 session. BotGuard is
 * the one exception: it runs here, since YouTube issues no token for a frame
 * with no origin of its own (docs/features/client-download.md, "The sandbox").
 * Asked once whether the extension answers; a tab without it imports as it
 * always has, through the server.
 *
 * The installed Mac app draws this same page, but from `app://selfmp3`, which
 * the extension does not talk to: it finds no extension and goes through the
 * server too.
 */
let downloader: Promise<DeviceYouTube | null> | null = null

/**
 * Whether this browser is one the extension is built for: Chrome and the
 * browsers made from it (Edge, Brave, Arc), which all give a page a
 * `window.chrome`. Firefox and Safari do not, and have no self.mp3 extension
 * (docs/features/browser-extension.md) — Settings leaves their switches out.
 */
const extensionBrowser =
  typeof window !== 'undefined' &&
  'chrome' in window &&
  // Chrome on a phone gives a page `window.chrome` too, and runs no extensions.
  !/Android|iPhone|iPad/i.test(navigator.userAgent)

/**
 * Settings' card for this: in a browser the extension runs in, and not in the
 * installed Mac app, which draws this page from an address the extension
 * does not talk to.
 */
export const downloadsHere = {
  available: extensionBrowser && !installedApp,
  title: 'In this browser',
  place: 'browser',
  hint: 'With the self.mp3 extension, YouTube songs are looked up, heard and downloaded in this browser, and your server adds them.',
}
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
  if (downloader && missedAt > 0 && Date.now() - missedAt > LOOK_AGAIN_MS) {
    // The new look is the one everyone waits on until it answers: a second
    // call meanwhile must not start a third, with its own frame and BotGuard.
    downloader = null
    missedAt = 0
  }
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
      return without(messageOf(error))
    }
  })()
  return downloader
}

/** Look for the extension now, and open the sandbox if it answers: the Import screen calls this as it opens. */
export function warmDeviceDownloads(): void {
  void deviceDownloader()
}

/** The songs heard here, kept as object URLs the page's audio can play. */
export const deviceListenUrl = listenFromDevice<string>(deviceDownloader, {
  keep: (_videoId, bytes) => URL.createObjectURL(new Blob([bytes], { type: 'audio/mp4' })),
  address: url => url,
  usable: () => true,
  drop: url => URL.revokeObjectURL(url),
})

export { deviceBudget, uploadDeviceFile } from './deviceShared'
