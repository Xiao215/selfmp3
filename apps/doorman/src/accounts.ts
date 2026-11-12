import { DoormanStorageSchema, type DoormanMe, type DoormanStorage } from '@selfmp3/shared'
import { z } from 'zod'
import { keep, recall, remember, type BoundedCache } from './boundedCache.js'
import type { Log } from './context.js'
import { DriveTargetSchema } from './drive.js'
import { sha256Hex } from './encoding.js'
import type { DoormanKeys } from './keys.js'
import { getRecord, putRecord, type KvStore } from './kv.js'
import { seal, unseal } from './seal.js'
import type { Session } from './sessions.js'
import type { AccountStorage } from './stores.js'

/**
 * What belongs to a Google account beyond its sessions: the one place its
 * library is kept, and the last time it signed out everywhere.
 *
 *   bucket:<sub>    where the library is and the way in, sealed (see seal.ts):
 *                   a bucket's details and key, or a Google Drive folder's ids
 *                   and Google's refresh token
 *   move:<sub>      where the library is being moved to, sealed the same way,
 *                   from the moment the new place is connected until the move
 *                   is finished or stopped (move.ts)
 *   signout:<sub>   { sessionsValidAfter }: older sessions are refused
 *
 * Each has a key of its own, written only by the one thing that changes it:
 * connecting or forgetting the storage, and signing out everywhere. KV is
 * eventually consistent, so a request that read a record a moment ago and
 * wrote it back whole could undo a change made meanwhile somewhere else.
 * With nothing else ever writing these keys, nothing can.
 *
 * Storage is opened only inside the Worker, to make its requests, and never
 * sent anywhere. Both records are remembered by each Worker instance for a
 * minute, which saves KV reads on nearly every file a device fetches; a
 * change is seen at once by the instance that made it, and by others within
 * the minute, as KV's own copies elsewhere catch up.
 */

/** What is sealed for a bucket: everything needed to sign a request to it. */
const StoredBucketSchema = z.object({
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string(),
  prefix: z.string(),
  keyId: z.string(),
  applicationKey: z.string(),
})

/** Where the library was moved here from, kept with the record so `/v1/me` can say (move.ts). */
const Moved = { movedFrom: DoormanStorageSchema.optional() }

/**
 * What is sealed. A Drive record says it is one; a bucket's is the bucket's
 * details and nothing else, as it was before there was any other kind.
 */
const StoredStorageSchema = z.union([
  DriveTargetSchema.extend({ kind: z.literal('drive'), ...Moved }),
  StoredBucketSchema.extend(Moved).transform(bucket => ({ kind: 'bucket' as const, ...bucket })),
])

const SignOutSchema = z.object({ sessionsValidAfter: z.string().datetime() })

interface AccountCache {
  /** `bucket:<sub>` as KV had it: the sealed string, or null. */
  readonly sealed: BoundedCache<string | null>
  /**
   * Opened storage, keyed by the sealed string it came from, so an entry is
   * only ever right — it needs no minute of its own, only a bound.
   */
  readonly opened: Map<string, AccountStorage>
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
   * Where the account keeps its library, opened, or null when it has nowhere.
   *
   * A sealed record that will not open — SEAL_KEY was changed, or the record
   * was edited — counts as none: the device is asked to connect its storage
   * again, which replaces it, rather than being stuck with an error.
   *
   * `sure` asks KV again before saying none, past what this instance
   * remembers. Google Drive is connected by a browser coming back from Google,
   * which may reach another instance than the device's next question does;
   * that instance would go on saying "none" for a minute to a device that was
   * just told it is connected.
   */
  async storage(sub: string, sure = false): Promise<AccountStorage | null> {
    let sealed = await this.#remembered(this.#cache.sealed, sub, () => this.#kv.get(bucketKey(sub)))
    if (sealed === null && sure) {
      sealed = await this.#kv.get(bucketKey(sub))
      this.#set(this.#cache.sealed, sub, sealed)
    }
    if (sealed === null) return null
    // Keyed by the account too, so a sealed value copied onto another
    // account's record is still refused here, as unseal would refuse it.
    const cacheKey = `${sub}\n${sealed}`
    const opened = this.#cache.opened.get(cacheKey)
    if (opened) return opened

    const storage = await this.#open(sealed, bucketKey(sub))
    if (!storage) {
      this.#log.warn('an account’s storage could not be opened; treating it as not connected')
      return null
    }
    keep(this.#cache.opened, cacheKey, storage)
    return storage
  }

  /** Seal storage and make it the account's, replacing any it had. One KV write. */
  async connect(sub: string, storage: AccountStorage): Promise<void> {
    const sealed = await this.#seal(storage, bucketKey(sub))
    await this.#kv.put(bucketKey(sub), sealed)
    this.#set(this.#cache.sealed, sub, sealed)
  }

  /**
   * Where the account's library is being moved to, or null when no move is
   * under way. Read from KV each time: a move is one device's few hundred
   * requests, once, and the browser that connected Google Drive for it may
   * have reached another instance than the device's next request does.
   */
  async moving(sub: string): Promise<AccountStorage | null> {
    const sealed = await this.#kv.get(moveKey(sub))
    return sealed === null ? null : this.#open(sealed, moveKey(sub))
  }

  /** Keep the place a move is going to, replacing one begun before. One KV write. */
  async startMove(sub: string, to: AccountStorage): Promise<void> {
    await this.#kv.put(moveKey(sub), await this.#seal(to, moveKey(sub)))
  }

  /** Forget the place a move was going to. It and what was copied there are left alone. */
  async stopMove(sub: string): Promise<void> {
    await this.#kv.delete(moveKey(sub))
  }

  async #seal(storage: AccountStorage, context: string): Promise<string> {
    const { seal: key } = await this.#keys()
    // A bucket's record is its details alone (`StoredStorageSchema`).
    const { kind, ...details } = storage
    return seal(JSON.stringify(kind === 'drive' ? storage : details), key, context)
  }

  /** A sealed record opened, or null for one that will not open under this SEAL_KEY and name. */
  async #open(sealed: string, context: string): Promise<AccountStorage | null> {
    const { seal: key } = await this.#keys()
    try {
      return StoredStorageSchema.parse(JSON.parse(await unseal(sealed, key, context)))
    } catch {
      return null
    }
  }

  /** Forget the storage. It and everything in it are left alone. One KV write. */
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

  /** Who is signed in and where their library is kept, for `/v1/me`. Never the key or the token. */
  async me(session: Session): Promise<DoormanMe> {
    const storage = await this.storage(session.sub, true)
    return {
      account: await accountId(session.sub),
      email: session.email,
      name: session.name,
      picture: session.picture,
      storage: storage && described(storage),
      ...(storage?.movedFrom ? { movedFrom: storage.movedFrom } : {}),
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

/**
 * The account as others may know it (`DoormanAccountSchema`): derived from the
 * Google id, so it never changes, without being it.
 */
async function accountId(sub: string): Promise<string> {
  return (await sha256Hex(`account:${sub}`)).slice(0, 32)
}

/** Storage as a device may know it: where it is, and never the way in. */
export function described(storage: AccountStorage): DoormanStorage {
  if (storage.kind === 'drive') return { kind: 'drive', folder: storage.root }
  return {
    kind: 'bucket',
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: storage.bucket,
    prefix: storage.prefix,
    keyIdHint: `${storage.keyId.slice(0, 6)}…`,
  }
}

function bucketKey(sub: string): string {
  return `bucket:${sub}`
}

function moveKey(sub: string): string {
  return `move:${sub}`
}

function signOutKey(sub: string): string {
  return `signout:${sub}`
}
