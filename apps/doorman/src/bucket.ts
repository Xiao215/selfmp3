import { AwsV4Signer } from 'aws4fetch'
import { fromUtf8, sha256Hex, utf8 } from './encoding.js'
import { discard, readBytes } from './http.js'
import { parseError, parseListing } from './xml.js'

/**
 * One account's bucket, spoken to over the S3 API: B2, R2, MinIO or AWS.
 *
 * Requests are signed with aws4fetch (AWS Signature Version 4 on WebCrypto)
 * and sent with the doorman's own fetch, so tests can hand in an S3 look-alike.
 *
 * What is signed is kept to what S3 requires — the host, the date and the
 * payload hash — and every other header rides along unsigned. Cloudflare
 * changes some headers on a Worker's requests on their way out: it rewrites
 * Accept-Encoding, does not reliably pass conditional headers upstream, and
 * can turn a HEAD into a GET. Backblaze met all three in their own Workers
 * proxy (github.com/backblaze-b2-samples/cloudflare-b2). A signed header that
 * arrives changed gets the request refused; an unsigned one is only a hint
 * that might not arrive, which for a Range or an If-None-Match costs a bigger
 * answer and nothing else. For the same reason a HEAD goes up as a GET whose
 * body is dropped unread.
 *
 * The payload hash is always `UNSIGNED-PAYLOAD`. Hashing a 10 MB song would
 * take far more than the 10 ms of CPU a request gets on the free plan; the
 * connection to the bucket is TLS, which already keeps the body intact on the
 * way. aws4fetch uses the header's value instead of hashing when it is given.
 *
 * Every request says `cache: 'no-store'`, so Cloudflare's cache, which a
 * Worker's requests pass through even to other sites, never holds anyone's
 * files.
 */

export interface BucketTarget {
  /** `https://s3.us-west-004.backblazeb2.com`, as `parseEndpoint` tidies it. */
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  /** The folder everything goes under, without slashes at either end. Empty for the root. */
  readonly prefix: string
  readonly keyId: string
  readonly applicationKey: string
}

/** What `fetch` is given. `duplex` is Node's, for a streamed body; the Workers runtime ignores it. */
export type FetchInit = RequestInit<RequestInitCfProperties> & { duplex?: 'half' }

/**
 * The global `fetch`'s shape, taking the options as options rather than on a
 * Request. That matters: the runtime reads `encodeResponseBody` only from
 * fetch's own options, and silently drops it from a Request passed in.
 */
export type Fetch = (url: string, init: FetchInit) => Promise<Response>

export interface BucketDeps {
  readonly fetch: Fetch
  readonly now: () => number
  /**
   * SigV4 signing keys, kept between requests: deriving one takes four HMACs.
   * Keyed by a hash of what each was derived from, never the key itself, and
   * emptied when it grows past a few dozen.
   */
  readonly signingKeys: Map<string, ArrayBuffer>
}

const SIGNING_KEYS_KEPT = 64

export interface BucketObject {
  /** Relative to the account's folder: `audio/4f1c….m4a`. */
  readonly key: string
  readonly size: number
}

/**
 * Why a request to the bucket failed, in terms of what to do about it — the
 * same kinds, and the same words, as the server's `CloudError`.
 */
export type BucketErrorKind = 'auth' | 'network' | 'missing' | 'other'

export class BucketError extends Error {
  readonly kind: BucketErrorKind

  constructor(kind: BucketErrorKind, message: string) {
    super(message)
    this.name = 'BucketError'
    this.kind = kind
  }
}

/** A thousand keys is a few hundred kilobytes of XML; an error a few hundred bytes. */
const MAX_LISTING_BYTES = 4 * 1024 * 1024
const MAX_ERROR_BYTES = 16 * 1024

/**
 * Listing, reading or writing format.json, and deleting give up after this
 * long. Streaming a song through has no limit: it takes as long as the
 * device's connection takes.
 */
const QUICK_TIMEOUT_MS = 30_000

const AUTH_CODES = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'Unauthorized',
  'Forbidden',
])

interface SendOptions {
  readonly query?: ReadonlyArray<readonly [string, string]>
  /** Sent as they are, and not signed. */
  readonly headers?: Headers
  readonly body?: Upload
  /** The bytes exactly as stored, with no decoding of a Content-Encoding. */
  readonly raw?: boolean
  readonly quick?: boolean
}

/** Bytes in hand, or a stream of them that is only ever handed on, never read here. */
type Upload = Uint8Array | { readonly stream: ReadableStream; readonly length: number }

export interface WriteOptions {
  readonly contentType: string
  readonly contentEncoding?: string | null
}

export class Bucket {
  readonly #target: BucketTarget
  readonly #deps: BucketDeps
  readonly #host: string
  /** `selfmp3/`, or nothing at the root of the bucket. */
  readonly #root: string

  constructor(target: BucketTarget, deps: BucketDeps) {
    this.#target = target
    this.#deps = deps
    this.#host = target.endpoint.replace(/^https?:\/\//, '')
    this.#root = target.prefix ? `${target.prefix}/` : ''
  }

  /** One page of what is under `prefix`, relative to the account's folder. */
  async list(
    prefix: string,
    cursor: string | null,
  ): Promise<{ objects: BucketObject[]; cursor: string | null }> {
    const query: Array<[string, string]> = [
      ['list-type', '2'],
      ['max-keys', '1000'],
      ['prefix', this.#root + prefix],
    ]
    if (cursor) query.push(['continuation-token', cursor])

    const response = await this.#send('GET', this.#path(null), { query, quick: true })
    if (!response.ok) throw await this.#explain(response)
    const bytes = await readBytes(response.body, MAX_LISTING_BYTES)
    const page = bytes.length < MAX_LISTING_BYTES ? parseListing(fromUtf8(bytes)) : null
    if (!page) {
      throw new BucketError('other', `${this.#host} answered a listing with something else.`)
    }

    const objects: BucketObject[] = []
    for (const object of page.objects) {
      if (!object.key.startsWith(this.#root)) continue
      objects.push({ key: object.key.slice(this.#root.length), size: object.size })
    }
    return { objects, cursor: page.truncated && page.nextToken ? page.nextToken : null }
  }

  /**
   * Whether an object is there. Asked as a GET of its first byte, dropped
   * unread: a HEAD may reach the bucket as a GET (see the top of this file).
   * An empty object answers the range with 416, which is still "there".
   */
  async exists(key: string): Promise<boolean> {
    const forward = new Headers({ range: 'bytes=0-0' })
    const response = await this.#send('GET', this.#path(key), { headers: forward, quick: true })
    if (response.status === 404) {
      await this.#absent(response)
      return false
    }
    if (![200, 206, 416].includes(response.status)) throw await this.#explain(response)
    await discard(response)
    return true
  }

  /** At most `limit` bytes of a small object, or null when there is none. */
  async read(key: string, limit: number): Promise<Uint8Array | null> {
    const response = await this.#send('GET', this.#path(key), { quick: true })
    if (response.status === 404) return this.#absent(response)
    if (!response.ok) throw await this.#explain(response)
    return readBytes(response.body, limit)
  }

  /**
   * Store an object. A stream is passed on as it arrives, never held whole:
   * the doorman sees a song's bytes go by and nothing more.
   */
  async write(key: string, body: Upload, options: WriteOptions): Promise<void> {
    const headers = new Headers({ 'content-type': options.contentType })
    if (options.contentEncoding) headers.set('content-encoding', options.contentEncoding)
    const quick = body instanceof Uint8Array
    const response = await this.#send('PUT', this.#path(key), { headers, body, quick })
    if (!response.ok) throw await this.#explain(response)
    await discard(response)
  }

  /** Deleting what is already gone is not an error. */
  async remove(key: string): Promise<void> {
    const response = await this.#send('DELETE', this.#path(key), { quick: true })
    if (response.status === 404) {
      await this.#absent(response)
      return
    }
    if (!response.ok) throw await this.#explain(response)
    await discard(response)
  }

  /**
   * An object as the bucket sends it, for the caller to pass on — status,
   * headers and body untouched, and the body not yet read. Null when there is
   * no such object.
   *
   * The body comes back exactly as stored. By default the runtime decodes a
   * response whose Content-Encoding it knows, so a gzipped snapshot would
   * arrive as plain JSON still labelled gzip; `encodeResponseBody: 'manual'`
   * keeps the stored bytes instead. The caller must send them on with
   * `encodeBody: 'manual'` for the same reason in the other direction: the
   * two only work as a pair (checked in workerd: either one alone sends gzip
   * inside gzip, or plain JSON labelled gzip).
   *
   * Answers a device can act on — 200, 206, 304, 412 and 416 — are returned;
   * anything else is a `BucketError`.
   */
  async fetchObject(
    method: 'GET' | 'HEAD',
    key: string,
    forward: Headers,
  ): Promise<Response | null> {
    const response = await this.#send('GET', this.#path(key), { headers: forward, raw: true })
    const { status } = response
    if (status === 404) return this.#absent(response)
    if (![200, 206, 304, 412, 416].includes(status)) throw await this.#explain(response)
    if (method === 'GET') return response

    await discard(response)
    return new Response(null, { status, headers: response.headers })
  }

  /**
   * A 404 means no such object — unless it is no such bucket, which B2 also
   * answers with a 404 and which must never pass for "that file is missing".
   */
  async #absent(response: Response): Promise<null> {
    const error = await this.#explain(response)
    if (error.kind === 'missing') throw error
    return null
  }

  async #send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const query = options.query
      ? `?${options.query.map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`).join('&')}`
      : ''
    const url = `${this.#target.endpoint}${path}${query}`

    const datetime = amzDate(this.#deps.now())
    const signer = new AwsV4Signer({
      method,
      url,
      headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
      accessKeyId: this.#target.keyId,
      secretAccessKey: this.#target.applicationKey,
      service: 's3',
      region: this.#target.region,
      cache: await this.#signingKeyFor(datetime.slice(0, 8)),
      datetime,
    })
    const signed = await signer.sign()
    const headers = new Headers(options.headers)
    signed.headers.forEach((value, name) => headers.set(name, value))

    const init: FetchInit = { method, headers, redirect: 'manual', cache: 'no-store' }
    if (options.raw) init.encodeResponseBody = 'manual'
    if (options.quick) init.signal = AbortSignal.timeout(QUICK_TIMEOUT_MS)
    if (options.body) Object.assign(init, uploadInit(options.body, headers))

    try {
      return await this.#deps.fetch(url, init)
    } catch {
      throw new BucketError('network', `Could not reach ${this.#host}.`)
    }
  }

  /**
   * The day's signing key, as aws4fetch wants it: a map in which it looks the
   * key up under the application key in plain text. So it gets a map of one,
   * made for this request; what outlives the request is kept under a hash.
   */
  async #signingKeyFor(date: string): Promise<Map<string, ArrayBuffer>> {
    const { applicationKey, region } = this.#target
    const kept = this.#deps.signingKeys
    const id = await sha256Hex(`${applicationKey}\n${date}\n${region}`)
    let key = kept.get(id)
    if (!key) {
      key = await deriveSigningKey(applicationKey, date, region)
      if (kept.size >= SIGNING_KEYS_KEPT) kept.clear()
      kept.set(id, key)
    }
    return new Map([[[applicationKey, date, region, 's3'].join(), key]])
  }

  /** `/<bucket>/<prefix>/<key>`: path-style, which every S3-compatible service takes. */
  #path(key: string | null): string {
    const parts = [this.#target.bucket]
    if (key !== null) parts.push(...(this.#root + key).split('/'))
    return `/${parts.map(rfc3986).join('/')}`
  }

  /** Turn a refusal into a message that says what to do about it, as the server's does. */
  async #explain(response: Response): Promise<BucketError> {
    const body = await readBytes(response.body, MAX_ERROR_BYTES)
    const { code, message } = parseError(fromUtf8(body))
    const { status } = response
    const bucket = this.#target.bucket

    if (code === 'NoSuchBucket') {
      return new BucketError('missing', `There is no bucket called “${bucket}” at ${this.#host}.`)
    }
    if (status === 401 || status === 403 || (code !== null && AUTH_CODES.has(code))) {
      return new BucketError(
        'auth',
        `The bucket refused the key${code ? ` (${code})` : ''}. Check the key ID and the ` +
          `application key, and that the key is allowed to use “${bucket}”.`,
      )
    }
    return new BucketError('other', `${this.#host}: ${this.#describe(status, code, message)}`)
  }

  /**
   * The bucket's own words, when it gave some: they are usually the useful
   * part ("the region 'us-east-1' is wrong; expecting 'eu-central-003'").
   * Trimmed, and with anything that could be the key taken out.
   */
  #describe(status: number, code: string | null, message: string | null): string {
    let text = message?.trim() || code || `it answered ${status}`
    for (const secret of [this.#target.applicationKey, this.#target.keyId]) {
      if (secret) text = text.split(secret).join('…')
    }
    if (text.length > 240) text = `${text.slice(0, 240)}…`
    return message?.trim() && code ? `${text} (${code})` : text
  }
}

/**
 * A request body S3 will take. S3 needs the length up front and does not take
 * a chunked upload, so a stream has to say how long it is.
 *
 * In the Worker that is what FixedLengthStream is for: the runtime then sends
 * Content-Length instead of chunking, and fails the upload if the stream turns
 * out longer or shorter. Bytes in hand have a length the runtime sends by
 * itself. Node, where the tests run, has no FixedLengthStream but lets a
 * request carry its own Content-Length, and wants `duplex` for any stream.
 */
function uploadInit(
  upload: Upload,
  headers: Headers,
): Pick<RequestInit, 'body'> & { duplex?: 'half' } {
  if (typeof FixedLengthStream === 'function') {
    if (upload instanceof Uint8Array) return { body: upload }
    const fixed = new FixedLengthStream(upload.length)
    // If the device's upload stops short this fails, the fixed-length side
    // errors, and so does the request to the bucket, which is where it is seen.
    void upload.stream.pipeTo(fixed.writable).catch(() => undefined)
    return { body: fixed.readable }
  }
  headers.set('content-length', String(upload.length))
  return upload instanceof Uint8Array ? { body: upload } : { body: upload.stream, duplex: 'half' }
}

/** SigV4's signing key: the secret, narrowed by HMAC to one day, region and service. */
async function deriveSigningKey(
  secret: string,
  date: string,
  region: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(utf8(`AWS4${secret}`), date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, 's3')
  return hmac(kService, 'aws4_request')
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, utf8(message))
}

/** `20260911T142205Z`, the timestamp SigV4 signs. */
function amzDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/** Percent-encoding as SigV4 spells it, so what is sent is exactly what was signed. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
