import { releaseBucket } from '@selfmp3/replica'
import { SW_MESSAGE } from '../../sw/names'
import { desktop } from './desktop/bridge'

/**
 * Ask the bucket again now, before its hold is up: the person raised the cap
 * at backblaze.com and pressed Try again. Every hold is let go — the page's
 * (`@selfmp3/replica`), the service worker's, which fetches the songs and
 * covers in a browser (sw.ts, `capped`), and the desktop shell's, which
 * streams them there (apps/desktop/src/main/stream.ts).
 */
export function askBucketAgain(): void {
  releaseBucket()
  if (desktop) {
    void desktop.bucket.release().catch(() => undefined)
    return
  }
  navigator.serviceWorker?.controller?.postMessage({ type: SW_MESSAGE.release })
}
