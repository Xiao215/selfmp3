import { Readable } from 'node:stream'
import type * as S3 from '@aws-sdk/client-s3'

/**
 * The AWS SDK, as the cloud bucket client (`store.ts`) uses it.
 *
 * The SDK is an optional dependency and is imported only when a bucket is
 * first touched, so a missing install produces an actionable error rather
 * than a module-resolution stack trace at boot. Its types cost nothing at
 * runtime, so those are the SDK's own.
 */

export type S3Module = typeof S3

export async function loadS3(): Promise<S3Module> {
  try {
    return await import('@aws-sdk/client-s3')
  } catch {
    throw new Error(
      'The cloud bucket needs the AWS SDK. Install it with:\n' + '  npm install @aws-sdk/client-s3',
    )
  }
}

/** The SDK's error's name, or nothing for anything that is not an Error. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

/** The HTTP status an SDK error carries in its metadata, when it has one. */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
  return typeof metadata?.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined
}

/** Whether an SDK error says there is no such object — and only that. */
export function isNotFound(error: unknown): boolean {
  const name = errorName(error)
  return name === 'NotFound' || name === 'NoSuchKey' || errorStatus(error) === 404
}

/** An object's body as one Buffer, whatever shape the SDK handed it over in. */
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
