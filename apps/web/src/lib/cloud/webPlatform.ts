import type { CloudPlatform, DeviceStore } from '@selfmp3/cloud'
import { deleteStored, readStored, writeStored } from '../../offline/mirror.js'
import { BASE, DOORMAN_URL } from '../platform.js'

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
}
