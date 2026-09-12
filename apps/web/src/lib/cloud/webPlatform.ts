import type { CloudPlatform, DeviceStore, TextCache } from '@selfmp3/cloud'
import { deleteStored, readStored, updateStored, writeStored } from '../../offline/mirror.js'
import { appPath, BASE, DOORMAN_URL } from '../platform.js'

/**
 * What a browser gives `@selfmp3/cloud` (packages/cloud/src/platform.ts).
 *
 * All of the browser in one file, so that everything else about keeping a copy
 * of the library is the same code the phone will run.
 *
 * Things are kept in IndexedDB rather than `localStorage` for one reason: the
 * service worker reads them too (sw.ts), to fetch a song from the bucket when
 * the player asks for one this device does not have yet, and a worker cannot
 * see `localStorage` at all.
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

/** Lyrics, in the Cache API — out of IndexedDB, which the replica fills. */
const FILES_CACHE = 'selfmp3-cloud-files-v1'

const textCache: TextCache = {
  read: async key => {
    if (typeof caches === 'undefined') return null
    const cached = await caches.open(FILES_CACHE).then(c => c.match(appPath(`cloud-files/${key}`)))
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

export const webPlatform: CloudPlatform = {
  doormanUrl: DOORMAN_URL,
  store,
  // The browser's own, which satisfies CloudFetch by being a superset of it.
  fetch: (url, init) => fetch(url, init as RequestInit),
  randomBytes: into => crypto.getRandomValues(into),
  // A tab can be returned to, so the doorman sends Google back here and the
  // code arrives in the address rather than being read off a page and typed.
  returnUrl: `${window.location.origin}${BASE}`,
  openSignIn: url => window.location.assign(url),

  deviceKind: (() => {
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
      // `bytes.slice()` rather than `bytes`: a Uint8Array may be backed by a
      // SharedArrayBuffer, which BlobPart does not accept, and slicing copies
      // into a plain one.
      const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'))
      return new Response(stream).text()
    }
    return new TextDecoder().decode(bytes)
  },

  textCache,
  warn: message => console.warn(`self.mp3: ${message}`),
}
