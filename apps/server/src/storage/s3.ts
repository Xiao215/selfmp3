import { Readable } from 'node:stream'
import type * as S3 from '@aws-sdk/client-s3'
import type * as Presigner from '@aws-sdk/s3-request-presigner'
import type { S3Client, S3ClientConfig } from '@aws-sdk/client-s3'
import { AUDIO_EXTENSIONS } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { RangeSource } from '../http/range.js'
import { normalizeKey, type StorageDriver, type StorageStat } from './driver.js'

/**
 * S3-compatible object storage (Cloudflare R2, Backblaze B2, MinIO, AWS).
 *
 * The AWS SDK is an optional dependency: nobody running the default local
 * setup should have to install ~40 MB of client libraries they will never
 * load. It is imported dynamically, and a missing install produces an
 * actionable error rather than a module-resolution stack trace at boot. Its
 * types cost nothing at runtime, so those are the SDK's own.
 *
 * To switch:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *   SELFMP3_STORAGE_DRIVER=s3 SELFMP3_S3_BUCKET=... npm start
 */

export type S3Module = typeof S3
type PresignerModule = typeof Presigner

/** Also used by the cloud bucket client, `bucket/store.ts`. */
export async function loadS3(): Promise<{ s3: S3Module; presigner: PresignerModule }> {
  try {
    const [s3, presigner] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ])
    return { s3, presigner }
  } catch {
    throw new Error(
      'The S3 storage driver needs the AWS SDK. Install it with:\n' +
        '  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner',
    )
  }
}

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3'
  readonly #bucket: string
  readonly #ttl: number
  #modules: { s3: S3Module; presigner: PresignerModule } | null = null
  #client: S3Client | null = null
  readonly #clientOptions: S3ClientConfig

  constructor(config: Config['s3']) {
    this.#bucket = config.bucket
    this.#ttl = config.signedUrlTtl
    this.#clientOptions = {
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    }
  }

  async #ready(): Promise<{ s3: S3Module; presigner: PresignerModule; client: S3Client }> {
    this.#modules ??= await loadS3()
    this.#client ??= new this.#modules.s3.S3Client(this.#clientOptions)
    return { ...this.#modules, client: this.#client }
  }

  async stat(key: string): Promise<StorageStat | null> {
    const { s3, client } = await this.#ready()
    try {
      const head = await client.send(
        new s3.HeadObjectCommand({ Bucket: this.#bucket, Key: normalizeKey(key) }),
      )
      const size = head.ContentLength ?? 0
      return {
        sizeBytes: size,
        modifiedAt: head.LastModified ?? new Date(0),
        etag: head.ETag ?? `"${size.toString(16)}"`,
      }
    } catch {
      return null
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null
  }

  async list(): Promise<string[]> {
    const { s3, client } = await this.#ready()
    const keys: string[] = []
    let token: string | undefined

    do {
      const page = await client.send(
        new s3.ListObjectsV2Command({
          Bucket: this.#bucket,
          MaxKeys: 1000,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      )
      for (const item of page.Contents ?? []) {
        const key = item.Key
        if (key === undefined) continue
        const lower = key.toLowerCase()
        if (AUDIO_EXTENSIONS.some(suffix => lower.endsWith(suffix))) keys.push(key)
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)

    keys.sort((a, b) => a.localeCompare(b))
    return keys
  }

  async read(key: string): Promise<Buffer> {
    const { s3, client } = await this.#ready()
    const object = await client.send(
      new s3.GetObjectCommand({ Bucket: this.#bucket, Key: normalizeKey(key) }),
    )
    return streamToBuffer(object.Body)
  }

  async write(key: string, data: Buffer | NodeJS.ReadableStream): Promise<void> {
    const { s3, client } = await this.#ready()
    const body = Buffer.isBuffer(data) ? data : await streamToBuffer(data)
    await client.send(
      new s3.PutObjectCommand({ Bucket: this.#bucket, Key: normalizeKey(key), Body: body }),
    )
  }

  async delete(key: string): Promise<void> {
    const { s3, client } = await this.#ready()
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.#bucket, Key: normalizeKey(key) }))
  }

  async rangeSource(key: string, mime: string): Promise<RangeSource | null> {
    const stat = await this.stat(key)
    if (!stat) return null
    const { s3, client } = await this.#ready()
    const bucket = this.#bucket
    const normalized = normalizeKey(key)

    return {
      sizeBytes: stat.sizeBytes,
      mime,
      etag: stat.etag,
      lastModified: stat.modifiedAt,
      open: async (start, end, signal) => {
        const object = await client.send(
          new s3.GetObjectCommand({
            Bucket: bucket,
            Key: normalized,
            Range: `bytes=${start}-${end}`,
          }),
          { abortSignal: signal },
        )
        // The SDK's body is a Node stream here; handed on as it is, the
        // response pulls from it at its own pace and closes it when it goes.
        const body = object.Body
        return body instanceof Readable ? body : Readable.from([await streamToBuffer(body)])
      },
    }
  }

  async signedUrl(key: string): Promise<string | null> {
    const { s3, presigner, client } = await this.#ready()
    const command = new s3.GetObjectCommand({ Bucket: this.#bucket, Key: normalizeKey(key) })
    return presigner.getSignedUrl(client, command, { expiresIn: this.#ttl })
  }

  localPath(): string | null {
    // Objects have no local path; callers download to a temp file when needed.
    return null
  }
}

export async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
    }
    return Buffer.concat(chunks)
  }
  // The AWS SDK v3 body also exposes a web-stream helper on some platforms.
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    const bytes = await (
      body as { transformToByteArray(): Promise<Uint8Array> }
    ).transformToByteArray()
    return Buffer.from(bytes)
  }
  throw new Error('unsupported S3 response body')
}
