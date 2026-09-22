import type { DoormanMe } from '@selfmp3/shared'
import { z } from 'zod'
import { keep, recall, remember, type BoundedCache } from './boundedCache.js'
import type { BucketTarget } from './bucket.js'
import type { Log } from './context.js'
import type { DoormanKeys } from './keys.js'
import { getRecord, putRecord, type KvStore } from './kv.js'
import { seal, unseal } from './seal.js'
import type { Session } from './sessions.js'

/**
 * What belongs to a Google account beyond its sessions: its one bucket, and
 * the last time it signed out everywhere.
 *
 *   bucket:<sub>    the bucket's details and key, sealed (see seal.ts)
 *   signout:<sub>   { sessionsValidAfter }: older sessions are refused
 *
 * Each has a key of its own, written only by the one thing that changes it:
 * connecting or forgetting the bucket, and signing out everywhere. KV is
 * eventually consistent, so a request that read a record a moment ago and
 * wrote it back whole could undo a change made meanwhile somewhere else.
 * With nothing else ever writing these keys, nothing can.
 *
 * A bucket is opened only inside the Worker, to sign requests, and never
 * sent anywhere. Both records are remembered by each Worker instance for a
 * minute, which saves KV reads on nearly every file a device fetches; a
 * change is seen at once by the instance that made it, and by others within
 * the minute, as KV's own copies elsewhere catch up.
 */

/** What is sealed: everything needed to sign a request to the bucket. */
const StoredBucketSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  keyId: z.string(),
  applicationKey: z.string(),
})

const SignOutSchema = z.object({ sessionsValidAfter: z.string().datetime() })

interface AccountCache {
  /** `bucket:<sub>` as KV had it: the sealed string, or null. */
  readonly sealed: BoundedCache<string | null>
  /**
   * Opened buckets, keyed by the sealed string they came from, so an entry is
   * only ever right — it needs no minute of its own, only a bound.
   */
  readonly opened: Map<string, BucketTarget>
  /** `signout:<sub>`, in milliseconds, or null for never. */
  readonly signedOut: BoundedCache<number | null>
}

export function newAccountCache(): AccountCache {
  return { sealed: new Map(), opened: new Map(), signedOut: new Map() }
}

export class Accounts {
  readonly #kv: KvStore
  readonly #now: () => number
  readonly #cache: AccountCache
  readonly #keys: () => Promise<DoormanKeys>
  readonly #log: Log

  constructor(
    kv: KvStore,
    now: () => number,
    cache: AccountCache,
    keys: () => Promise<DoormanKeys>,
    log: Log,
  ) {
    this.#kv = kv
    this.#now = now
    this.#cache = cache
    this.#keys = keys
    this.#log = log
  }

  /**
   * The account's bucket, opened, or null when it has none.
   *
   * A sealed bucket that will not open — SEAL_KEY was changed, or the record
   * was edited — counts as none: the device is asked to connect its bucket
   * again, which replaces it, rather than being stuck with an error.
   */
  async bucket(sub: string): Promise<BucketTarget | null> {
    const sealed = await this.#remembered(this.#cache.sealed, sub, () =>
      this.#kv.get(bucketKey(sub)),
    )
    if (sealed === null) return null
    // Keyed by the account too, so a sealed value copied onto another
    // account's record is still refused here, as unseal would refuse it.
    const cacheKey = `${sub}\n${sealed}`
    const opened = this.#cache.opened.get(cacheKey)
    if (opened) return opened

    const { seal: key } = await this.#keys()
    let target: BucketTarget
    try {
      target = StoredBucketSchema.parse(JSON.parse(await unseal(sealed, key, bucketKey(sub))))
    } catch {
      this.#log.warn('an account’s bucket could not be opened; treating it as not connected')
      return null
    }
    keep(this.#cache.opened, cacheKey, target)
    return target
  }

  /** Seal a bucket and make it the account's, replacing any it had. One KV write. */
  async connect(sub: string, target: BucketTarget): Promise<void> {
    const { seal: key } = await this.#keys()
    const sealed = await seal(JSON.stringify(target), key, bucketKey(sub))
    await this.#kv.put(bucketKey(sub), sealed)
    this.#set(this.#cache.sealed, sub, sealed)
  }

  /** Forget the bucket. The bucket and everything in it are left alone. One KV write. */
  async disconnect(sub: string): Promise<void> {
    await this.#kv.delete(bucketKey(sub))
    this.#set(this.#cache.sealed, sub, null)
  }

  /** When the account last signed out everywhere, in milliseconds, or null. */
  sessionsValidAfter(sub: string): Promise<number | null> {
    return this.#remembered(this.#cache.signedOut, sub, async () => {
      const record = await getRecord(this.#kv, signOutKey(sub), SignOutSchema)
      return record ? Date.parse(record.sessionsValidAfter) : null
    })
  }

  /** End every session the account has, this one included. One KV write. */
  async signOutEverywhere(sub: string): Promise<void> {
    const now = this.#now()
    await putRecord(this.#kv, signOutKey(sub), {
      sessionsValidAfter: new Date(now).toISOString(),
    })
    this.#set(this.#cache.signedOut, sub, now)
  }

  /** Who is signed in and where their bucket is, for `/v1/me`. Never the key. */
  async me(session: Session): Promise<DoormanMe> {
    const target = await this.bucket(session.sub)
    return {
      email: session.email,
      name: session.name,
      picture: session.picture,
      storage: target
        ? {
            endpoint: target.endpoint,
            region: target.region,
            bucket: target.bucket,
            prefix: target.prefix,
            keyIdHint: `${target.keyId.slice(0, 6)}…`,
          }
        : null,
    }
  }

  async #remembered<Value>(
    cache: BoundedCache<Value>,
    sub: string,
    read: () => Promise<Value>,
  ): Promise<Value> {
    const cached = recall(cache, sub, this.#now())
    if (cached !== undefined) return cached
    const value = await read()
    this.#set(cache, sub, value)
    return value
  }

  #set<Value>(cache: BoundedCache<Value>, sub: string, value: Value): void {
    remember(cache, sub, value, this.#now())
  }
}

function bucketKey(sub: string): string {
  return `bucket:${sub}`
}

function signOutKey(sub: string): string {
  return `signout:${sub}`
}
