import type { BucketRefusalKind } from '@selfmp3/shared'

/**
 * The cloud bucket, as the sync sees it: a handful of operations on keys
 * relative to the bucket's folder. See docs/SYNC.md.
 *
 * Deliberately not a `StorageDriver`. That interface is where this server keeps
 * its library; this is where the library is published for every device, and
 * it needs different things — "put this exact file under this name", and
 * errors that say whether the key, the address or the connection is at fault.
 */

export interface CloudObject {
  /** Relative to the bucket's folder: `audio/4f1c….m4a`. */
  readonly key: string
  readonly size: number
}

export interface CloudPutOptions {
  readonly contentType: string
  readonly contentEncoding?: string
}

export interface CloudStore {
  /** "b2 · my-bucket/selfmp3", for logs. */
  readonly description: string
  head(key: string): Promise<CloudObject | null>
  get(key: string): Promise<Buffer | null>
  put(key: string, body: Buffer, options: CloudPutOptions): Promise<void>
  /** Every object whose key starts with `prefix`, relative to the bucket's folder. */
  list(prefix: string): Promise<CloudObject[]>
  delete(key: string): Promise<void>
  /**
   * Where the bucket's change counter stands — the doorman's `/v1/changes`,
   * which moves whenever a snapshot or a log file is written or deleted — or
   * null for a bucket that keeps none: a folder standing in for one. With a
   * counter, a listing of `log/` that would find what the last one did need
   * not be made (docs/SYNC.md, "Caps"); without, only listing tells.
   */
  changes(): Promise<string | null>
  /**
   * Where the counter would stand now had nothing moved it since `held` but
   * this server's own writes and deletes through this store: a snapshot it
   * published changes no listing it needs to make again. `held` itself when
   * none of them moved it.
   */
  followOwn(held: string): string
  /**
   * Bytes `start` to `end` of an object, inclusive as HTTP counts them, or
   * null when there is no such object. How a song this server no longer holds
   * a copy of is streamed to a player (routes/media.ts) — which is why it can
   * be called off: the player that asked has often skipped on by the time the
   * bucket answers.
   */
  range(
    key: string,
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<NodeJS.ReadableStream | null>
  /**
   * These files were deleted from the bucket: every share link that lends one
   * says its song is gone now, rather than when someone next presses Play
   * (docs/features/share-links.md). Only a bucket reached through the doorman
   * has links to tell.
   */
  unlend?(keys: readonly string[]): Promise<void>
}

/**
 * Why a bucket operation failed, in terms of what to do about it: the kinds
 * of packages/shared's `BucketRefusalKind`, which the doorman's own errors use.
 */
export class CloudError extends Error {
  readonly kind: BucketRefusalKind

  constructor(kind: BucketRefusalKind, message: string) {
    super(message)
    this.name = 'CloudError'
    this.kind = kind
  }
}

/** `https://s3.us-west-004.backblazeb2.com` → `s3.us-west-004.backblazeb2.com`, for messages. */
export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
