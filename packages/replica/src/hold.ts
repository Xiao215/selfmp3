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

/**
 * What Backblaze counts against a day's allowance, each under a cap of its
 * own: reading a file (Class B) and listing a folder (Class C). One can be
 * spent while the other is not — on 2026-10-08 every read was refused while
 * every listing still answered — so each is held, and let go, by itself: a
 * listing that answers says nothing about whether a read would.
 */
export type BucketCall = 'read' | 'list'

const holds: Record<BucketCall, BucketHold | null> = { read: null, list: null }
const listeners = new Set<(hold: BucketHold | null) => void>()

/**
 * The hold in force for that kind of call, or null when the bucket may be
 * asked. With no kind, either: what a screen says while anything is held.
 */
export function bucketHold(call?: BucketCall, now = Date.now()): BucketHold | null {
  for (const kind of KINDS) {
    const held = holds[kind]
    if (held !== null && held.until <= now) release(kind)
  }
  return call ? holds[call] : (holds.read ?? holds.list)
}

/** Refused for the day: leave that kind of call alone for a while, and say so. */
export function holdBucket(
  message: string,
  call: BucketCall = 'read',
  now = Date.now(),
): BucketHold {
  holds[call] = { message, until: now + BUCKET_HOLD_MS }
  notify()
  return holds[call]
}

/** That kind of call was answered, or (with none) the app signed out: nothing of it is held. */
export function releaseBucket(call?: BucketCall): void {
  for (const kind of call ? [call] : KINDS) release(kind)
}

const KINDS: readonly BucketCall[] = ['read', 'list']

function release(call: BucketCall): void {
  if (holds[call] === null) return
  holds[call] = null
  notify()
}

function notify(): void {
  const held = holds.read ?? holds.list
  for (const listener of listeners) listener(held)
}

/** Hear a hold start and end. */
export function onBucketHold(listener: (hold: BucketHold | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
