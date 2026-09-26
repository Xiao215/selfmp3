/**
 * The bucket refusing for the day (docs/SYNC.md, "Caps").
 *
 * Backblaze stops answering reads once a day's count passes the account's cap,
 * and the doorman says so with `bucket_cap_exceeded`. Every read after that is
 * refused the same way until the cap is raised or the day turns, so asking is
 * pointless — and this device kept asking: a look at the bucket on every
 * library read, every song's words as it played, every cover a row drew. So a
 * refusal is held for a while, and reads inside the hold are refused here
 * without a request. Ten minutes, then one real request finds out whether it
 * is over: a cap raised at backblaze.com should not wait for midnight.
 *
 * One hold for the whole app, because the bucket is one thing: the session
 * sets it (`doormanFetch`), a browser's service worker reports its own to it
 * (apps/app/src/ports/serviceWorker.web.ts), and the screens read it to say
 * why the words and the covers are not coming.
 */

export const BUCKET_HOLD_MS = 10 * 60_000
export const BUCKET_CAP_CODE = 'bucket_cap_exceeded'

export interface BucketHold {
  /** The doorman's words: what happened and what to do about it. */
  readonly message: string
  /** When the bucket is asked again. */
  readonly until: number
}

let hold: BucketHold | null = null
const listeners = new Set<(hold: BucketHold | null) => void>()

/** The hold in force, or null when the bucket may be asked. */
export function bucketHold(now = Date.now()): BucketHold | null {
  if (hold !== null && hold.until <= now) release()
  return hold
}

/** Refused for the day: leave the bucket alone for a while, and say so. */
export function holdBucket(message: string, now = Date.now()): BucketHold {
  hold = { message, until: now + BUCKET_HOLD_MS }
  for (const listener of listeners) listener(hold)
  return hold
}

/** The bucket answered, or the app signed out: nothing is held any more. */
export function releaseBucket(): void {
  release()
}

function release(): void {
  if (hold === null) return
  hold = null
  for (const listener of listeners) listener(null)
}

/** Hear the hold start and end. */
export function onBucketHold(listener: (hold: BucketHold | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
