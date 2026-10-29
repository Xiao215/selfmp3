import { lapseBucketHold } from '@selfmp3/replica'

/**
 * Ask the bucket again now, before its hold is up: the person raised the cap
 * at backblaze.com and pressed Try again, or the app is asking by itself
 * (`useAskBucketBack`, `bucketAsk.model.ts`). A phone fetches bucket files itself,
 * so the replica's hold is the only one there is (the browser's twin also
 * tells its service worker, and the desktop shell).
 */
export function askBucketAgain(): void {
  lapseBucketHold()
}
