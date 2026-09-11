import type { DoormanMe } from '@selfmp3/shared'
import { z } from 'zod'
import type { BucketTarget } from './bucket.js'
import type { Log } from './context.js'
import { getRecord, putRecord, type KvStore } from './kv.js'
import { seal, unseal } from './seal.js'
import type { Identity } from './sessions.js'

/**
 * Google accounts, and the one bucket that belongs to each.
 *
 * The record is keyed by Google's `sub`, which never changes, and keeps the
 * name, address and picture Google gave at the last sign-in. The bucket —
 * where it is and the key to it — is one sealed string (see seal.ts); it is
 * opened only inside the Worker, to sign requests, and never sent anywhere.
 *
 * Like sessions, accounts are remembered by each Worker instance for a
 * minute, which saves a KV read on nearly every file a device fetches.
 * Connecting or forgetting a bucket updates this instance at once; others
 * catch up within the minute, as KV's own copies elsewhere do.
 */

export const AccountSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  /** `v1:…` — the bucket, sealed. Null until one is connected. */
  storage: z.string().nullable(),
})
export type Account = z.infer<typeof AccountSchema>

/** What is sealed: everything needed to sign a request to the bucket. */
const StoredBucketSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  keyId: z.string(),
  applicationKey: z.string(),
})

const CACHE_MS = 60_000
const CACHE_LIMIT = 500

export interface AccountCache {
  readonly accounts: Map<string, { account: Account | null; until: number }>
  /** Opened buckets, by account and the sealed string they came from. */
  readonly buckets: Map<string, BucketTarget>
}

export function newAccountCache(): AccountCache {
  return { accounts: new Map(), buckets: new Map() }
}

export class Accounts {
  readonly #kv: KvStore
  readonly #now: () => number
  readonly #cache: AccountCache
  readonly #sealKey: () => Promise<CryptoKey>
  readonly #log: Log

  constructor(
    kv: KvStore,
    now: () => number,
    cache: AccountCache,
    sealKey: () => Promise<CryptoKey>,
    log: Log,
  ) {
    this.#kv = kv
    this.#now = now
    this.#cache = cache
    this.#sealKey = sealKey
    this.#log = log
  }

  async get(sub: string): Promise<Account | null> {
    const now = this.#now()
    const cached = this.#cache.accounts.get(sub)
    if (cached && cached.until > now) return cached.account
    const account = await getRecord(this.#kv, accountKey(sub), AccountSchema)
    this.#remember(sub, account)
    return account
  }

  /** Record a sign-in: the latest name and picture, and whatever bucket it already had. */
  async signedIn(identity: Identity): Promise<Account> {
    const existing = await getRecord(this.#kv, accountKey(identity.sub), AccountSchema)
    return this.#save(identity.sub, {
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
      storage: existing?.storage ?? null,
    })
  }

  /** Seal a bucket and make it this account's, replacing any it had. */
  async connect(sub: string, account: Account, target: BucketTarget): Promise<Account> {
    const sealed = await seal(JSON.stringify(target), await this.#sealKey(), sealContext(sub))
    return this.#save(sub, { ...account, storage: sealed })
  }

  /** Forget the bucket. The bucket and everything in it are left alone. */
  async disconnect(sub: string, account: Account): Promise<Account> {
    return this.#save(sub, { ...account, storage: null })
  }

  /**
   * The account's bucket, opened, or null when it has none.
   *
   * A sealed bucket that will not open — SEAL_KEY was changed, or the record
   * was edited — counts as none: the device is asked to connect its bucket
   * again, which replaces it, rather than being stuck with an error.
   */
  async bucket(sub: string, account: Account): Promise<BucketTarget | null> {
    if (account.storage === null) return null
    // Keyed by the account too, so a sealed value copied onto another
    // account's record is still refused here, as unseal would refuse it.
    const cacheKey = `${sub}\n${account.storage}`
    const cached = this.#cache.buckets.get(cacheKey)
    if (cached) return cached

    const key = await this.#sealKey()
    let target: BucketTarget
    try {
      const plain = await unseal(account.storage, key, sealContext(sub))
      target = StoredBucketSchema.parse(JSON.parse(plain))
    } catch {
      this.#log.warn('an account’s bucket could not be opened; treating it as not connected')
      return null
    }
    if (this.#cache.buckets.size >= CACHE_LIMIT) this.#cache.buckets.clear()
    this.#cache.buckets.set(cacheKey, target)
    return target
  }

  /** Who is signed in and where their bucket is, for `/v1/me`. Never the key. */
  async me(sub: string, account: Account): Promise<DoormanMe> {
    const target = await this.bucket(sub, account)
    return {
      email: account.email,
      name: account.name,
      picture: account.picture,
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

  async #save(sub: string, account: Account): Promise<Account> {
    await putRecord(this.#kv, accountKey(sub), account)
    this.#remember(sub, account)
    return account
  }

  #remember(sub: string, account: Account | null): void {
    if (this.#cache.accounts.size >= CACHE_LIMIT) this.#cache.accounts.clear()
    this.#cache.accounts.set(sub, { account, until: this.#now() + CACHE_MS })
  }
}

function accountKey(sub: string): string {
  return `account:${sub}`
}

/** What a sealed bucket is tied to: see seal.ts. */
function sealContext(sub: string): string {
  return `account:${sub}`
}
