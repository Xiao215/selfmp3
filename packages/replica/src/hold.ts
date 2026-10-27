import { BUCKET_HOLD_MS, type BucketCall } from '@selfmp3/shared'
import type { DeviceStore } from './platform.js'

/**
 * The bucket refusing for the day (docs/SYNC.md, "Caps").
 *
 * Backblaze stops answering reads once a day's count passes the account's cap,
 * and the doorman says so with `bucket_cap_exceeded`. Every read after that is
 * refused the same way until the cap is raised or the day turns, so asking is
 * pointless — and a device asks often: a look at the bucket on every
 * library read, every song's words as it played, every cover a row drew. So a
 * refusal is held for a while, and reads inside the hold are refused here
 * without a request. Then one real request finds out whether it is over: a cap
 * raised at backblaze.com should not wait for midnight. Half a minute at
 * first, since the person who raised it is likely looking, and twice as long
 * for each refusal in a row after, up to `BUCKET_HOLD_MS` (R2-M9: a fixed ten
 * minutes kept a raised cap refused for all of them). The app also asks before
 * a hold is up — Try again, a song pressed, the page looked at again, a hold
 * about to run out (apps/app/src/connection/useDoormanTrouble.ts,
 * `useAskBucketBack`) — by a read sent through the hold or by letting it go
 * (`lapseBucketHold`).
 *
 * One hold for the whole app, because the bucket is one thing: the session
 * sets it (`doormanFetch`), a browser's service worker reports its own to it
 * (apps/app/src/ports/serviceWorker.web.ts), and the screens read it to say
 * why the words and the covers are not coming.
 */

export interface BucketHold {
  /** The doorman's words: what happened and what to do about it. */
  readonly message: string
  /** When the bucket is asked again. */
  readonly until: number
  /** When it last refused. */
  readonly heardAt: number
  /** How many times in a row it has refused, since it last answered. */
  readonly refusals: number
}

/** How long the first refusal is believed; each one in a row after, twice as long. */
export const FIRST_BUCKET_HOLD_MS = 30_000

/** How long to hold after that many refusals in a row. */
function holdFor(refusals: number): number {
  return Math.min(FIRST_BUCKET_HOLD_MS * 2 ** Math.max(0, refusals - 1), BUCKET_HOLD_MS)
}

/*
 * What Backblaze counts against a day's allowance (shared's `BucketCall`),
 * each under a cap of its own: reading a file (Class B) and listing a folder
 * (Class C). One can be spent while the other is not — every read refused
 * while every listing still answers — so each is held, and let go, by itself:
 * a listing that answers says nothing about whether a read would.
 */
const holds: Record<BucketCall, BucketHold | null> = { read: null, list: null }
/** Refusals in a row of each kind: kept through a hold let go, forgotten once it answers. */
const streaks: Record<BucketCall, number> = { read: 0, list: 0 }
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
  /** The answer to a request sent through the hold to find out (`asking`): always another ask. */
  asked = false,
): BucketHold {
  const held = holds[call]
  // Heard inside a hold, it is one of the requests that went out with the one
  // that started it — a row of covers, a song and its words — not another ask.
  const refusals = !asked && held !== null && held.until > now ? held.refusals : streaks[call] + 1
  streaks[call] = refusals
  holds[call] = { message, until: now + holdFor(refusals), heardAt: now, refusals }
  notify()
  return holds[call]
}

/** That kind of call was answered, or (with none) the app signed out: nothing of it is held. */
export function releaseBucket(call?: BucketCall): void {
  for (const kind of call ? [call] : KINDS) {
    streaks[kind] = 0
    release(kind)
  }
}

/**
 * Let that kind's hold (or, with none, every one) go now, to ask the bucket
 * again before it is up. Unlike an answer, this forgets nothing: refused
 * again, the next hold is the longer one.
 */
export function lapseBucketHold(call?: BucketCall): void {
  for (const kind of call ? [call] : KINDS) release(kind)
}

/**
 * How many times in a row that kind of call (or, with none, either) has been
 * refused since the bucket last answered: above 0 with no hold in force, a
 * hold has run out and nothing has asked since.
 */
export function bucketRefusals(call?: BucketCall): number {
  return call ? streaks[call] : Math.max(streaks.read, streaks.list)
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

const HOLDS_KEY = 'bucket-holds'

let keeping = false

/**
 * Keep the holds in the device's store, so a reload inside one still knows.
 *
 * Held in memory only, a reload forgot the refusal: the library came back
 * from this device's copy with nothing asked of the bucket, the screens said
 * all was well, and the first song played was refused all over again. Read
 * back once, for whatever is left of each; written whenever one starts or
 * ends. Once per app, whoever asks first.
 */
export function keepHolds(store: DeviceStore, now = Date.now()): void {
  if (keeping) return
  keeping = true
  onBucketHold(() => {
    void store.write(HOLDS_KEY, { ...holds }).catch(() => undefined)
  })
  void (async () => {
    try {
      const saved = (await store.read(HOLDS_KEY)) as Partial<Record<BucketCall, unknown>> | null
      let restored = false
      for (const kind of KINDS) {
        const held = saved?.[kind]
        if (holds[kind] !== null || !isHold(held) || held.until <= now) continue
        // Never longer than a hold lasts: a clock set back must not hold for days.
        holds[kind] = { ...held, until: Math.min(held.until, now + BUCKET_HOLD_MS) }
        streaks[kind] = held.refusals
        restored = true
      }
      if (restored) notify()
    } catch {
      // Nothing kept, or no storage: held in memory as before.
    }
  })()
}

function isHold(value: unknown): value is BucketHold {
  if (typeof value !== 'object' || value === null) return false
  const hold = value as BucketHold
  return (
    typeof hold.message === 'string' &&
    typeof hold.until === 'number' &&
    typeof hold.heardAt === 'number' &&
    Number.isInteger(hold.refusals) &&
    hold.refusals > 0
  )
}
