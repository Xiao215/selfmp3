import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'
import type { CloudPlatform, DeviceStore } from '@selfmp3/replica'
import type { KeyValueStore } from './store.js'

/**
 * What the extension's background worker gives `@selfmp3/replica`
 * (packages/replica/src/platform.ts).
 *
 * The same shape the browser app fills in, with two differences that are the
 * whole of what being an extension changes:
 *
 * - **Where it comes back to.** Google's page cannot redirect to a
 *   `chrome-extension://` address, so the doorman is sent to
 *   `https://<id>.chromiumapp.org/`, which Chrome intercepts rather than
 *   loading. That address is never fetched and needs no CORS; the doorman
 *   allows it only as a return address (docs/features/browser-extension.md, "What the spike settled", question 2).
 * - **Who opens it.** `chrome.identity.launchWebAuthFlow` lives on the options
 *   page, which stays alive while Google is slow; a worker suspended in the
 *   middle would lose the code. So this platform does not open anything — it
 *   hands the URL back, and the page opens it (`signIn` in handlers.ts).
 */

/** `https://<id>.chromiumapp.org/`, which Chrome hands back to the flow that asked. */
function redirectUrl(): string {
  return chrome.identity.getRedirectURL()
}

interface PlatformDeps {
  readonly store: KeyValueStore
  readonly fetch: typeof fetch
  /** Where `beginSignIn` should leave the doorman's URL, for the page to open. */
  readonly openSignIn: (url: string) => void
  readonly doormanUrl?: string
}

/** The store, as the replica wants it: quiet about a `remove` with nothing to remove. */
function deviceStore(store: KeyValueStore): DeviceStore {
  return {
    read: key => store.read(key),
    write: (key, value) => store.write(key, value),
    remove: async key => {
      try {
        await store.remove(key)
      } catch {
        // Nothing stored, or no storage at all. Losing it is survivable;
        // throwing in the middle of a sign-out is not.
      }
    },
    update: (key, change) => store.update(key, change),
  }
}

export function extensionCloudPlatform({
  store,
  fetch: fetchImpl,
  openSignIn,
  doormanUrl = DEFAULT_DOORMAN_URL,
}: PlatformDeps): CloudPlatform {
  return {
    doormanUrl,
    store: deviceStore(store),
    fetch: (url, init) => fetchImpl(url, init as RequestInit),
    randomBytes: into => crypto.getRandomValues(into),
    returnUrl: redirectUrl(),
    openSignIn,
    deviceKind: 'extension',

    /*
     * A worker has no tab to come back to the front of, so the network coming
     * back is the whole of what it can notice. The outbox is flushed straight
     * after every write as well (handlers.ts), which is what actually carries
     * a request to the bucket; this is the second chance.
     */
    onWake: run => {
      self.addEventListener('online', () => run())
    },

    /**
     * Snapshots are stored gzip-compressed, and the browser undoes that itself
     * when the doorman passes the encoding on. This is the case where it does
     * not, and it is the browser app's code because it is the same browser.
     */
    decodeText: async bytes => {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        const stream = new Blob([bytes.slice()])
          .stream()
          .pipeThrough(new DecompressionStream('gzip'))
        return new Response(stream).text()
      }
      return new TextDecoder().decode(bytes)
    },

    warn: message => console.warn(`self.mp3: ${message}`),
  }
}
