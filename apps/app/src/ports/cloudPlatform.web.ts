import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'
import type { CloudPlatform, DeviceStore, TextCache } from '@selfmp3/cloud'
import Constants from 'expo-constants'
import { appPath } from './appPath'
import { desktop } from './desktop/bridge'
import { deleteStored, readStored, updateStored, writeStored } from './idbStore.web'

/**
 * What a browser gives `@selfmp3/cloud` (packages/cloud/src/platform.ts): the
 * web app's `lib/cloud/webPlatform.ts`.
 *
 * Until this file the web build used the phone's, whose store writes files
 * through expo-file-system, which a browser does not have. Signing in to the
 * cloud there threw on the first write, so GitHub Pages could not keep a
 * session.
 */

const store: DeviceStore = {
  read: key => readStored(key),
  write: (key, value) => writeStored(key, value),
  remove: async key => {
    try {
      await deleteStored(key)
    } catch {
      // Nothing stored, or a private window with no storage to speak of.
    }
  },
  // One IndexedDB transaction, because two tabs share this origin: a read and
  // a later write could otherwise hand out one log sequence number twice.
  update: (key, change) => updateStored(key, change),
}

/** Lyrics, in the Cache API: out of IndexedDB, which the replica fills. */
const FILES_CACHE = 'selfmp3-cloud-files-v1'

const textCache: TextCache = {
  read: async key => {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(FILES_CACHE)
    const cached = await cache.match(appPath(`cloud-files/${key}`))
    return cached ? cached.text() : null
  },
  write: async (key, text) => {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(FILES_CACHE)
    await cache.put(
      appPath(`cloud-files/${key}`),
      new Response(text, { headers: { 'Content-Type': 'text/plain' } }),
    )
  },
  clear: async () => {
    if (typeof caches === 'undefined') return
    await caches.delete(FILES_CACHE)
  },
}

/** The doorman this build signs in through: the phone's rule, from `extra`, which Expo inlines on web too. */
const configured = (Constants.expoConfig?.extra as { doormanUrl?: unknown } | undefined)?.doormanUrl
const doormanUrl =
  typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_DOORMAN_URL

export const cloudPlatform: CloudPlatform = {
  doormanUrl,
  store,
  // The browser's own, which satisfies CloudFetch by being a superset of it.
  fetch: (url, init) => fetch(url, init as RequestInit),
  randomBytes: into => crypto.getRandomValues(into),

  /**
   * Back to the sign-in screen, under this build's base. A tab can be returned
   * to, so the doorman sends Google back here with the code in the fragment,
   * where the screen reads it, rather than showing it to be typed.
   *
   * The installed app is returned to by scheme instead. It uses the phone's
   * `selfmp3://sign-in`, which the doorman's `safeReturn` already allows and
   * which therefore needs nothing deployed — and the sign-in itself opens in
   * the person's own browser, because Google refuses an embedded window and
   * because a browser that already knows them is one fewer password typed.
   *
   * A doorman older than this app drops a scheme it does not know and shows the
   * code on its own page, and the typed-code path still works. That degradation
   * is the phone's and the desktop inherits it.
   */
  returnUrl: desktop ? 'selfmp3://sign-in' : `${window.location.origin}${appPath('sign-in')}`,
  openSignIn: url => (desktop ? desktop.openExternal(url) : window.location.assign(url)),

  deviceKind: (() => {
    if (desktop) return 'browser'
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
    if (/iPhone/.test(agent)) return 'iphone'
    if (/iPad/.test(agent)) return 'ipad'
    if (/Android/.test(agent)) return 'android'
    return 'browser'
  })(),

  onWake: run => {
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') run()
    })
  },

  /**
   * Snapshots are stored gzip-compressed. The browser undoes that itself when
   * the doorman passes the encoding on, and this does it when it does not.
   */
  decodeText: async bytes => {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      // A copy, because a Uint8Array may be backed by a SharedArrayBuffer,
      // which BlobPart does not accept.
      const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'))
      return new Response(stream).text()
    }
    return new TextDecoder().decode(bytes)
  },

  textCache,
  warn: message => console.warn(`self.mp3: ${message}`),
}
