import {
  messageOf,
  CHANGES_HEADER,
  DOORMAN_ERROR,
  DoormanError,
  FORMAT_KEY,
  SNAPSHOTS_FOLDER,
  isCloudFileKey,
  isCloudListPrefix,
  isDeletableCloudKey,
  isHashNamedCloudKey,
  isLookedAtCloudKey,
  relayedRange,
  type DoormanChanges,
  type DoormanList,
} from '@selfmp3/shared'
import { changesOf, requireBucket, requireSession, type Context } from './context.js'
import {
  badRequest,
  discard,
  errorResponse,
  forbidden,
  json,
  methodNotAllowed,
  noContent,
  notFound,
} from './http.js'
import type { Bucket } from './bucket.js'
import type { Session } from './sessions.js'

/**
 * A signed-in device's reads and writes, passed through to its bucket.
 *
 * Keys are relative to the account's folder, and only the library's own
 * files may pass: `isCloudFileKey` and `isCloudListPrefix` from the shared
 * package decide, before anything reaches the bucket.
 *
 * A session can write, and delete what the library has let go of.
 * `format.json` is the doorman's own, written when a bucket is connected, and
 * no device may replace or delete it. A file named by the hash of its bytes
 * is deleted once no song names it (docs/SYNC.md), which the server asks for
 * after the snapshot without the song is up.
 * And what a file says about itself — its type and encoding — is held to
 * the few shapes the library uses.
 *
 * Every write and delete of a snapshot or a log file moves the account's
 * change counter (changes.ts), and says so in its answer, so devices can tell
 * when a look at the bucket would find nothing new without listing.
 *
 * Bodies stream through in both directions and are never held whole, which
 * keeps each request inside the free plan's 10 ms of CPU however big the
 * song: the Worker only hands bytes on, and the runtime does the moving.
 */

/** What a device may say about the copy it has, passed to the bucket as it is. */
const CONDITIONS = [
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

/** `audio/mp4`, `application/json`, `text/plain; charset=utf-8`. */
const CONTENT_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:; ?charset=[a-z0-9-]+)?$/i

/** The largest request body the free plan lets through. */
const MAX_UPLOAD_MB = 100
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** `GET /v1/list?prefix=<p>&cursor=<c>` — one page of a folder. */
export async function list(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  const prefix = ctx.url.searchParams.get('prefix') ?? ''
  if (!isCloudListPrefix(prefix)) throw badRequest('that is not a folder a device may list')
  const cursor = ctx.url.searchParams.get('cursor')
  if (cursor !== null && (cursor === '' || cursor.length > 1024)) {
    throw badRequest('that is not a cursor from a listing')
  }

  const bucket = await requireBucket(ctx, session)
  const page = await bucket.list(prefix, cursor)
  const body: DoormanList = {
    // Anything else in the folder is not the library's, so not a device's business.
    objects: page.objects.filter(object => isCloudFileKey(object.key)),
    cursor: page.cursor,
  }
  return json(body)
}

/** `GET /v1/changes` — where the account's change counter stands. */
export async function changes(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  const body: DoormanChanges = { changes: await changesOf(ctx, session).read() }
  return json(body)
}

/** `GET | HEAD | PUT | DELETE /v1/files/<key>` */
export async function file(ctx: Context, encodedKey: string): Promise<Response> {
  const method = ctx.request.method
  if (method !== 'GET' && method !== 'HEAD' && method !== 'PUT' && method !== 'DELETE') {
    return methodNotAllowed(['GET', 'HEAD', 'PUT', 'DELETE'])
  }
  const session = await requireSession(ctx)
  const key = fileKey(encodedKey)

  switch (method) {
    case 'GET':
    case 'HEAD':
      return read(ctx, session, key, method)
    case 'PUT':
      return write(ctx, session, key)
    case 'DELETE':
      return remove(ctx, session, key)
  }
}

async function read(
  ctx: Context,
  session: Session,
  key: string,
  method: 'GET' | 'HEAD',
): Promise<Response> {
  return relayRead(ctx, await requireBucket(ctx, session), key, method)
}

/**
 * A file from a bucket, as a device reads it: the request's range and
 * conditions passed on, and what the bucket says about the file passed back.
 * A device's own reads come here, and so do a room's members' reads of a
 * song lent to the room (rooms.ts).
 */
export async function relayRead(
  ctx: Context,
  bucket: Bucket,
  key: string,
  method: 'GET' | 'HEAD',
): Promise<Response> {
  const forward = new Headers()
  const range = relayedRange(ctx.request.headers.get('range'))
  if (range !== null) forward.set('range', range)
  for (const name of CONDITIONS) {
    const value = ctx.request.headers.get(name)
    if (value !== null) forward.set(name, value)
  }

  const upstream = await bucket.fetchObject(method, key, forward)
  if (!upstream) throw notFound('no such file')
  if (upstream.status === 412) {
    await discard(upstream)
    throw new DoormanError(
      412,
      DOORMAN_ERROR.preconditionFailed,
      'the file is not the one you have',
    )
  }
  if (upstream.status === 416) {
    await discard(upstream)
    const response = errorResponse(
      new DoormanError(416, DOORMAN_ERROR.rangeNotSatisfiable, 'that range is not in the file'),
    )
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) response.headers.set('content-range', contentRange)
    return response
  }

  const headers = new Headers()
  for (const name of RELAYED) {
    const value = upstream.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  headers.set(
    'cache-control',
    isHashNamedCloudKey(key) ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  )
  // A file is the library's data, never a page: even one a device stored as
  // text/html cannot run anything from the doorman's address.
  headers.set('content-security-policy', 'sandbox')
  headers.set('x-content-type-options', 'nosniff')

  // The bytes as stored, headers and all. They were fetched undecoded (see
  // Bucket.fetchObject), so they are still in the Content-Encoding the headers
  // name; `encodeBody: 'manual'` sends them on as they are, where the default
  // would compress a gzipped snapshot a second time.
  return new Response(upstream.body, { status: upstream.status, headers, encodeBody: 'manual' })
}

async function write(ctx: Context, session: Session, key: string): Promise<Response> {
  if (key === FORMAT_KEY) {
    throw forbidden('format.json is written by the doorman when a bucket is connected')
  }
  const declared = ctx.request.headers.get('content-length')
  if (declared === null) {
    throw new DoormanError(
      411,
      DOORMAN_ERROR.lengthRequired,
      'say how big the file is, with Content-Length',
    )
  }
  if (!/^\s*\d{1,15}\s*$/.test(declared)) throw badRequest('Content-Length is not a number')
  const length = Number(declared)
  if (length > MAX_UPLOAD_BYTES) {
    throw new DoormanError(413, DOORMAN_ERROR.tooLarge, `a file can be at most ${MAX_UPLOAD_MB} MB`)
  }
  const body = ctx.request.body
  if (length > 0 && !body) throw badRequest('the file is missing')

  const contentType = ctx.request.headers.get('content-type')?.trim() || 'application/octet-stream'
  if (!CONTENT_TYPE.test(contentType)) {
    throw badRequest('Content-Type should be a plain media type, like audio/mp4')
  }
  const encoding = ctx.request.headers.get('content-encoding')?.trim().toLowerCase() || null
  // Snapshots are stored gzipped (docs/SYNC.md). Nothing else is encoded at all.
  if (encoding !== null && !(encoding === 'gzip' && key.startsWith(SNAPSHOTS_FOLDER))) {
    throw badRequest('only a snapshot may have a Content-Encoding, and only gzip')
  }

  // A file named by its hash is sent as it is, without asking the bucket
  // first whether it is there. Asking was a GET, a counted call, on every
  // upload, and it almost always answered no: the one writer of such files is
  // a server that has the bucket's listing and sends only what it lacks.
  // Sending one twice puts the same bytes under the same name. The bucket
  // cannot refuse it for us — Backblaze takes If-None-Match on a PUT and
  // ignores it — and nothing here needs it to.
  const bucket = await requireBucket(ctx, session)
  await bucket.write(key, length > 0 && body ? { stream: body, length } : new Uint8Array(0), {
    contentType,
    contentEncoding: encoding,
  })
  return counted(ctx, session, key, noContent())
}

async function remove(ctx: Context, session: Session, key: string): Promise<Response> {
  if (!isDeletableCloudKey(key)) {
    throw forbidden('format.json is never deleted')
  }
  const bucket = await requireBucket(ctx, session)
  await bucket.remove(key)
  return counted(ctx, session, key, noContent())
}

/**
 * The answer to a write or delete that went through, with the change counter
 * moved on when the key is one a look lists.
 *
 * The bucket has the change by now, and the counter moves after it: a device
 * that reads the counter before listing can then never hold a new count with
 * an old listing. A counter that cannot be reached costs the header and
 * nothing else — the write stands, and devices find the change at their next
 * full listing.
 */
async function counted(
  ctx: Context,
  session: Session,
  key: string,
  response: Response,
): Promise<Response> {
  if (!isLookedAtCloudKey(key)) return response
  try {
    const { before, after } = await changesOf(ctx, session).bump()
    response.headers.set(CHANGES_HEADER, `${before} ${after}`)
  } catch (error) {
    ctx.log.warn('the change counter could not be moved', {
      message: messageOf(error),
    })
  }
  return response
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
