import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { S3Client } from '@aws-sdk/client-s3'
import type { CloudConnection } from '../repositories/cloud.js'
import { loadS3, streamToBuffer, type S3Module } from '../storage/s3.js'

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
}

/**
 * Why a bucket operation failed, in terms of what to do about it:
 * `auth` — the key is wrong or not allowed; `network` — the bucket could not
 * be reached; `missing` — no such bucket; `cap` — the account's allowance for
 * the day is used up, so nothing else will get through either; `other` —
 * anything else.
 */
type CloudErrorKind = 'auth' | 'network' | 'missing' | 'cap' | 'other'

export class CloudError extends Error {
  readonly kind: CloudErrorKind

  constructor(kind: CloudErrorKind, message: string) {
    super(message)
    this.name = 'CloudError'
    this.kind = kind
  }
}

/** Any S3-compatible bucket: B2, R2, MinIO, AWS. */
export class S3CloudStore implements CloudStore {
  readonly description: string
  readonly #connection: CloudConnection
  #ready: Promise<{ s3: S3Module; client: S3Client }> | null = null

  constructor(connection: CloudConnection) {
    this.#connection = connection
    const host = connection.endpoint.replace(/^https?:\/\//, '')
    const folder = connection.prefix
      ? `${connection.bucket}/${connection.prefix}`
      : connection.bucket
    this.description = `${host} · ${folder}`
  }

  #client(): Promise<{ s3: S3Module; client: S3Client }> {
    this.#ready ??= loadS3().then(({ s3 }) => ({
      s3,
      client: new s3.S3Client({
        region: this.#connection.region,
        endpoint: this.#connection.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: this.#connection.keyId,
          secretAccessKey: this.#connection.applicationKey,
        },
        // Newer SDKs add CRC checksums to every upload by default, and not
        // every S3-compatible service accepts them. Content-MD5, sent below,
        // is the integrity check they all understand.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
    }))
    return this.#ready
  }

  #key(key: string): string {
    return this.#connection.prefix ? `${this.#connection.prefix}/${key}` : key
  }

  async head(key: string): Promise<CloudObject | null> {
    const { s3, client } = await this.#client()
    try {
      const head = await client.send(
        new s3.HeadObjectCommand({ Bucket: this.#connection.bucket, Key: this.#key(key) }),
      )
      return { key, size: head.ContentLength ?? 0 }
    } catch (error) {
      if (isNotFound(error)) return null
      throw this.#explain(error)
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const { s3, client } = await this.#client()
    try {
      const object = await client.send(
        new s3.GetObjectCommand({ Bucket: this.#connection.bucket, Key: this.#key(key) }),
      )
      return await streamToBuffer(object.Body)
    } catch (error) {
      if (isNotFound(error)) return null
      throw this.#explain(error)
    }
  }

  async range(
    key: string,
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<NodeJS.ReadableStream | null> {
    const { s3, client } = await this.#client()
    try {
      const object = await client.send(
        new s3.GetObjectCommand({
          Bucket: this.#connection.bucket,
          Key: this.#key(key),
          Range: `bytes=${start}-${end}`,
        }),
        { abortSignal: signal },
      )
      const body = object.Body
      return body instanceof Readable ? body : Readable.from([await streamToBuffer(body)])
    } catch (error) {
      if (isNotFound(error)) return null
      throw this.#explain(error)
    }
  }

  async put(key: string, body: Buffer, options: CloudPutOptions): Promise<void> {
    const { s3, client } = await this.#client()
    try {
      await client.send(
        new s3.PutObjectCommand({
          Bucket: this.#connection.bucket,
          Key: this.#key(key),
          Body: body,
          ContentType: options.contentType,
          ContentMD5: createHash('md5').update(body).digest('base64'),
          ...(options.contentEncoding ? { ContentEncoding: options.contentEncoding } : {}),
        }),
      )
    } catch (error) {
      throw this.#explain(error)
    }
  }

  async list(prefix: string): Promise<CloudObject[]> {
    const { s3, client } = await this.#client()
    const root = this.#connection.prefix ? `${this.#connection.prefix}/` : ''
    const objects: CloudObject[] = []
    let token: string | undefined

    try {
      do {
        const page = await client.send(
          new s3.ListObjectsV2Command({
            Bucket: this.#connection.bucket,
            Prefix: root + prefix,
            MaxKeys: 1000,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        )
        for (const item of page.Contents ?? []) {
          const full = item.Key
          if (full === undefined || !full.startsWith(root)) continue
          objects.push({ key: full.slice(root.length), size: item.Size ?? 0 })
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
    } catch (error) {
      throw this.#explain(error)
    }

    return objects
  }

  async delete(key: string): Promise<void> {
    const { s3, client } = await this.#client()
    try {
      await client.send(
        new s3.DeleteObjectCommand({ Bucket: this.#connection.bucket, Key: this.#key(key) }),
      )
    } catch (error) {
      if (isNotFound(error)) return
      throw this.#explain(error)
    }
  }

  /** Turn an SDK error into one that says what to do about it. */
  #explain(error: unknown): CloudError {
    if (error instanceof CloudError) return error
    const host = this.#connection.endpoint.replace(/^https?:\/\//, '')
    const name = errorName(error)
    const status = errorStatus(error)
    const code = errorCode(error)

    if (name === 'NoSuchBucket') {
      return new CloudError(
        'missing',
        `There is no bucket called “${this.#connection.bucket}” at ${host}.`,
      )
    }
    const said = error instanceof Error ? error.message : ''
    if (
      status === 401 ||
      status === 403 ||
      [
        'InvalidAccessKeyId',
        'SignatureDoesNotMatch',
        'AccessDenied',
        'Unauthorized',
        'Forbidden',
      ].includes(name)
    ) {
      // Backblaze answers a used-up daily cap with the same 403 a wrong key
      // gets, and says which only in its message.
      if (/cap exceeded/i.test(said)) {
        return new CloudError(
          'cap',
          `Backblaze says “${said}”: the bucket's allowance for today is used up. Raise it ` +
            'under Caps & Alerts at backblaze.com, or wait — caps reset at midnight GMT, 5 pm Pacific.',
        )
      }
      return new CloudError(
        'auth',
        `The bucket refused the key${name ? ` (${name})` : ''}. Check the key ID and the ` +
          `application key, and that the key is allowed to use “${this.#connection.bucket}”.`,
      )
    }
    if (
      status === undefined &&
      ([
        'ENOTFOUND',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENETUNREACH',
      ].includes(code) ||
        name === 'TimeoutError')
    ) {
      return new CloudError('network', `Could not reach ${host}.`)
    }
    const message = error instanceof Error ? error.message : String(error)
    return new CloudError('other', `${host}: ${message}`)
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
  return typeof metadata?.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') return code
  // Node's fetch hides the socket error one level down.
  const cause = (error as { cause?: { code?: unknown } }).cause
  return typeof cause?.code === 'string' ? cause.code : ''
}

function isNotFound(error: unknown): boolean {
  const name = errorName(error)
  return name === 'NotFound' || name === 'NoSuchKey' || errorStatus(error) === 404
}
