import type { BucketRefusalKind } from '@selfmp3/shared'

/**
 * Where one account's library is kept, as the doorman uses it: the five
 * things it ever does to storage, and nothing a driver would have to pretend.
 *
 * Two drivers answer to it: an S3 bucket (bucket.ts: B2, R2, MinIO, AWS) and a
 * folder in the account's own Google Drive (drive.ts). An account has one or
 * the other, never both (accounts.ts), and `Stores.open` (stores.ts) picks.
 * Keys are the library's own (`audio/4f1c….m4a`, packages/shared's cloud.ts),
 * the same in either; how a key becomes a place is the driver's business.
 * docs/features/storage-providers.md says how each S3 behaviour the devices
 * lean on is kept by the Drive driver.
 */
export interface Store {
  /**
   * One page of the files whose keys start with `prefix`, in key order. The
   * cursor is the driver's own: handed back as it was given, for the next page.
   */
  list(
    prefix: string,
    cursor: string | null,
  ): Promise<{ objects: StoredObject[]; cursor: string | null }>

  /** At most `limit` bytes of a small file, or null when there is none. */
  read(key: string, limit: number): Promise<Uint8Array | null>

  /**
   * Store a file, replacing one already under the key. A stream is passed on
   * as it arrives, never held whole: the doorman sees a song's bytes go by and
   * nothing more.
   */
  write(key: string, body: Upload, options: WriteOptions): Promise<void>

  /** Deleting what is already gone is not an error. */
  remove(key: string): Promise<void>

  /**
   * A file for a device, to be passed on: the body exactly as stored and not
   * yet read, under the headers a device uses (files.ts's `RELAYED`). Null
   * when there is no such file.
   *
   * `forward` carries the device's Range and conditions. The answers a device
   * can act on — 200, 206, 304, 412 and 416 — are returned; anything else is a
   * `StoreError`. The body is in the Content-Encoding the headers name, so the
   * caller sends it on with `encodeBody: 'manual'`.
   */
  fetchObject(method: 'GET' | 'HEAD', key: string, forward: Headers): Promise<Response | null>
}

export interface StoredObject {
  /** Relative to the account's folder: `audio/4f1c….m4a`. */
  readonly key: string
  readonly size: number
}

/** Bytes in hand, or a stream of them that is only ever handed on, never read here. */
export type Upload = Uint8Array | { readonly stream: ReadableStream; readonly length: number }

export interface WriteOptions {
  readonly contentType: string
  readonly contentEncoding?: string | null
}

/**
 * Why a request to storage failed, in terms of what to do about it — the same
 * kinds, and for a bucket the same words, as the server's `CloudError`: both
 * read a bucket's refusal with packages/shared's `classifyBucketRefusal`.
 */
export class StoreError extends Error {
  readonly kind: BucketRefusalKind

  constructor(kind: BucketRefusalKind, message: string) {
    super(message)
    this.name = 'StoreError'
    this.kind = kind
  }
}

/** What `fetch` is given. `duplex` is Node's, for a streamed body; the Workers runtime ignores it. */
export type FetchInit = RequestInit<RequestInitCfProperties> & { duplex?: 'half' }

/**
 * The global `fetch`'s shape, taking the options as options rather than on a
 * Request. That matters: the runtime reads `encodeResponseBody` only from
 * fetch's own options, and silently drops it from a Request passed in.
 */
export type Fetch = (url: string, init: FetchInit) => Promise<Response>

/**
 * A request body of a known length. S3 needs the length up front and does not
 * take a chunked upload, and Drive's upload is told the length when it starts,
 * so a stream has to say how long it is.
 *
 * In the Worker that is what FixedLengthStream is for: the runtime then sends
 * Content-Length instead of chunking, and fails the upload if the stream turns
 * out longer or shorter. Bytes in hand have a length the runtime sends by
 * itself. Node, where the tests run, has no FixedLengthStream but lets a
 * request carry its own Content-Length, and wants `duplex` for any stream.
 */
export function uploadInit(
  upload: Upload,
  headers: Headers,
): Pick<RequestInit, 'body'> & { duplex?: 'half' } {
  if (typeof FixedLengthStream === 'function') {
    if (upload instanceof Uint8Array) return { body: upload }
    const fixed = new FixedLengthStream(upload.length)
    // If the device's upload stops short this fails, the fixed-length side
    // errors, and so does the request to storage, which is where it is seen.
    void upload.stream.pipeTo(fixed.writable).catch(() => undefined)
    return { body: fixed.readable }
  }
  headers.set('content-length', String(upload.length))
  return upload instanceof Uint8Array ? { body: upload } : { body: upload.stream, duplex: 'half' }
}
