import {
  isCloudFileKey,
  isCloudListPrefix,
  isDeletableCloudKey,
  type DoormanList,
} from '@selfmp3/shared'
import { requireBucket, requireSession, type Context } from './context.js'
import {
  DoormanError,
  badRequest,
  discard,
  errorResponse,
  forbidden,
  json,
  noContent,
  notFound,
} from './http.js'

/**
 * A signed-in device's reads and writes, passed through to its bucket.
 *
 * Keys are relative to the account's folder, and only the library's own
 * files may pass: `isCloudFileKey` and `isCloudListPrefix` from the shared
 * package decide, before anything reaches the bucket.
 *
 * Bodies stream through in both directions and are never held whole, which
 * keeps each request inside the free plan's 10 ms of CPU however big the
 * song: the Worker only hands bytes on, and the runtime does the moving.
 */

/** Named by the hash of their bytes: the same key is the same bytes, forever. */
const HASH_NAMED = /^(?:audio|covers|lyrics)\//

/** What a device may say about the part it wants, or the copy it has. */
const FORWARDED = [
  'range',
  'if-none-match',
  'if-modified-since',
  'if-match',
  'if-unmodified-since',
  'if-range',
]

/** What the bucket says about the object that a device can use. */
const RELAYED = [
  'content-type',
  'content-length',
  'content-range',
  'content-encoding',
  'etag',
  'last-modified',
  'accept-ranges',
]

/** The largest request body the free plan lets through. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** `GET /v1/list?prefix=<p>&cursor=<c>` — one page of a folder. */
export async function list(ctx: Context): Promise<Response> {
  await requireSession(ctx)
  const prefix = ctx.url.searchParams.get('prefix') ?? ''
  if (!isCloudListPrefix(prefix)) throw badRequest('that is not a folder a device may list')
  const cursor = ctx.url.searchParams.get('cursor')
  if (cursor !== null && (cursor === '' || cursor.length > 1024)) {
    throw badRequest('that is not a cursor from a listing')
  }

  const bucket = await requireBucket(ctx)
  const page = await bucket.list(prefix, cursor)
  const body: DoormanList = {
    // Anything else in the folder is not the library's, so not a device's business.
    objects: page.objects.filter(object => isCloudFileKey(object.key)),
    cursor: page.cursor,
  }
  return json(body)
}

/** `GET | HEAD | PUT | DELETE /v1/files/<key>` */
export async function file(ctx: Context, encodedKey: string): Promise<Response> {
  const method = ctx.request.method
  if (method !== 'GET' && method !== 'HEAD' && method !== 'PUT' && method !== 'DELETE') {
    const response = errorResponse(
      new DoormanError(405, 'method_not_allowed', 'use GET, HEAD, PUT or DELETE'),
    )
    response.headers.set('allow', 'GET, HEAD, PUT, DELETE')
    return response
  }
  await requireSession(ctx)
  const key = fileKey(encodedKey)

  switch (method) {
    case 'GET':
    case 'HEAD':
      return read(ctx, key, method)
    case 'PUT':
      return write(ctx, key)
    case 'DELETE':
      return remove(ctx, key)
  }
}

async function read(ctx: Context, key: string, method: 'GET' | 'HEAD'): Promise<Response> {
  const forward = new Headers()
  for (const name of FORWARDED) {
    const value = ctx.request.headers.get(name)
    if (value !== null) forward.set(name, value)
  }

  const bucket = await requireBucket(ctx)
  const upstream = await bucket.fetchObject(method, key, forward)
  if (!upstream) throw notFound('no such file')
  if (upstream.status === 412) {
    await discard(upstream)
    throw new DoormanError(412, 'precondition_failed', 'the file is not the one you have')
  }
  if (upstream.status === 416) {
    await discard(upstream)
    const response = errorResponse(
      new DoormanError(416, 'range_not_satisfiable', 'that range is not in the file'),
    )
    const range = upstream.headers.get('content-range')
    if (range) response.headers.set('content-range', range)
    return response
  }

  const headers = new Headers()
  for (const name of RELAYED) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  headers.set(
    'cache-control',
    HASH_NAMED.test(key) ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  )
  headers.set('x-content-type-options', 'nosniff')

  // The bytes as stored, headers and all. They were fetched undecoded (see
  // Bucket.fetchObject), so they are still in the Content-Encoding the headers
  // name; `encodeBody: 'manual'` sends them on as they are, where the default
  // would compress a gzipped snapshot a second time.
  return new Response(upstream.body, { status: upstream.status, headers, encodeBody: 'manual' })
}

async function write(ctx: Context, key: string): Promise<Response> {
  const declared = ctx.request.headers.get('content-length')
  if (declared === null) {
    throw new DoormanError(411, 'length_required', 'say how big the file is, with Content-Length')
  }
  if (!/^\s*\d{1,15}\s*$/.test(declared)) throw badRequest('Content-Length is not a number')
  const length = Number(declared)
  if (length > MAX_UPLOAD_BYTES) {
    throw new DoormanError(413, 'too_large', 'a file can be at most 100 MB')
  }
  const body = ctx.request.body
  if (length > 0 && !body) throw badRequest('the file is missing')

  const contentType = header(ctx.request, 'content-type') ?? 'application/octet-stream'
  const contentEncoding = header(ctx.request, 'content-encoding')

  const bucket = await requireBucket(ctx)
  await bucket.write(key, length > 0 && body ? { stream: body, length } : new Uint8Array(0), {
    contentType,
    contentEncoding,
  })
  return noContent()
}

async function remove(ctx: Context, key: string): Promise<Response> {
  if (!isDeletableCloudKey(key)) {
    throw forbidden('only snapshots and change logs are ever deleted')
  }
  const bucket = await requireBucket(ctx)
  await bucket.remove(key)
  return noContent()
}

/** The key from the path, percent-decoded, and only if it is one of the library's. */
function fileKey(encoded: string): string {
  let key: string
  try {
    key = decodeURIComponent(encoded)
  } catch {
    throw badRequest('that is not a file a device may read or write')
  }
  if (!isCloudFileKey(key)) throw badRequest('that is not a file a device may read or write')
  return key
}

/** A header worth passing on to the bucket: present, and of a sane length. */
function header(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim()
  if (!value) return null
  if (value.length > 200) throw badRequest(`${name} is too long`)
  return value
}
