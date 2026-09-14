import {
  CLOUD_FORMAT,
  CloudConnectSchema,
  CloudFormatSchema,
  FORMAT_KEY,
  parseEndpoint,
  type CloudConnect,
  type CloudFormat,
} from '@selfmp3/shared'
import { Bucket, BucketError, type BucketTarget } from './bucket.js'
import { requireSession, type Context } from './context.js'
import { fromUtf8, utf8 } from './encoding.js'
import { badRequest, json, readJson, unprocessable } from './http.js'

/**
 * Who is signed in, and connecting the one bucket that belongs to them.
 *
 * Connecting tries the key before anything is kept, the way the server's
 * `CloudSyncService.connect` does: list, then read `format.json` — or, in a
 * new bucket, write one and read it back, which proves the key can read as
 * well as write. A mistake comes back while the form is still open, as the
 * same message the server gives: whether it was the key, the address or the
 * bucket. Only a key that passes is sealed and saved.
 */

/** A format.json is a hundred bytes. Anything far bigger is not one of ours. */
const FORMAT_MAX_BYTES = 64 * 1024

/** A region as providers name them: `us-west-004`, `auto`, `eu-central-1`. */
const REGION = /^[a-z0-9-]{1,64}$/
/** A key ID goes into every request's Authorization header, so: visible ASCII, no spaces. */
const KEY_ID = /^[\x21-\x7e]{1,200}$/

/** `GET /v1/me` */
export async function me(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  return json(await ctx.accounts.me(session))
}

/** `PUT /v1/storage` — connect a bucket, or replace the one connected. */
export async function connect(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  const target = targetFrom(await readJson(ctx.request, CloudConnectSchema), ctx.env.DEV === 'true')

  const bucket = new Bucket(target, ctx.bucketDeps)
  try {
    await bucket.list(FORMAT_KEY, null)
    await checkFormat(bucket, ctx.now)
  } catch (error) {
    // The bucket's answer is the useful part. It goes back to the form as it is.
    if (error instanceof BucketError) throw unprocessable(error.message)
    throw error
  }

  await ctx.accounts.connect(session.sub, target)
  return json(await ctx.accounts.me(session))
}

/** `DELETE /v1/storage` — forget the bucket. The bucket and its files are left alone. */
export async function disconnect(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  await ctx.accounts.disconnect(session.sub)
  return json(await ctx.accounts.me(session))
}

/**
 * The form's fields, tidied as the server tidies them, and checked for what S3
 * alone would not catch. The region and the key ID are checked for shape
 * before anything is built from them: both end up in a request header, and
 * a character no header may hold would otherwise fail deep inside the
 * runtime, as an error that says nothing.
 */
function targetFrom(input: CloudConnect, dev: boolean): BucketTarget {
  const keyId = input.keyId.trim()
  if (!KEY_ID.test(keyId)) {
    throw badRequest('keyId: a key ID is letters, digits and symbols, with no spaces')
  }
  const givenRegion = input.region?.trim()
  if (givenRegion && !REGION.test(givenRegion)) {
    throw badRequest('region: lower-case letters, digits and dashes, like us-west-004')
  }

  const endpoint = parseEndpoint(input.endpoint)
  if (!endpoint) {
    throw unprocessable('That endpoint is not an address, like s3.us-west-004.backblazeb2.com.')
  }
  // The doorman is on the public internet: songs must not cross it in the
  // clear. A bucket on this computer is the one exception, and only in
  // `wrangler dev --env dev`, whose settings say DEV.
  const host = new URL(endpoint.url).hostname
  const local = host === 'localhost' || host === '127.0.0.1'
  if (endpoint.url.startsWith('http:') && !(dev && local)) {
    throw unprocessable('The endpoint has to be an https:// address.')
  }
  const region = givenRegion || endpoint.region
  if (!region) {
    throw unprocessable('Say which region the bucket is in, as its provider names it.')
  }
  const prefix = input.prefix.replace(/^\/+|\/+$/g, '')
  // S3 would take `.` and `..` literally, but the URL the doorman builds from
  // them would not, and its requests would land in some other folder.
  if (prefix.split('/').some(part => part === '.' || part === '..')) {
    throw unprocessable('The folder cannot have . or .. in its path.')
  }
  return {
    endpoint: endpoint.url,
    region,
    bucket: input.bucket.trim(),
    prefix,
    keyId,
    applicationKey: input.applicationKey.trim(),
  }
}

/**
 * Make sure the bucket is one this build may write to: `format.json` says so,
 * or there is none yet and this writes it — and reads it back. The same rules,
 * and the same words, as the server's `#checkFormat`.
 */
async function checkFormat(bucket: Bucket, now: () => number): Promise<void> {
  const existing = await bucket.read(FORMAT_KEY, FORMAT_MAX_BYTES + 1)
  if (existing) {
    const parsed =
      existing.length <= FORMAT_MAX_BYTES ? CloudFormatSchema.safeParse(parseJson(existing)) : null
    if (!parsed?.success) {
      throw unprocessable(
        'That folder of the bucket has a format.json that is not self.mp3’s. Choose another folder.',
      )
    }
    if (parsed.data.format > CLOUD_FORMAT) {
      throw unprocessable(
        `This bucket was set up by a newer version of self.mp3 (format ${parsed.data.format}). ` +
          'Update the doorman before connecting it.',
      )
    }
    return
  }

  const format: CloudFormat = {
    app: 'self.mp3',
    format: CLOUD_FORMAT,
    createdAt: new Date(now()).toISOString(),
    createdBy: 'doorman',
  }
  await bucket.write(FORMAT_KEY, utf8(`${JSON.stringify(format, null, 2)}\n`), {
    contentType: 'application/json',
  })
  const readBack = await bucket.read(FORMAT_KEY, FORMAT_MAX_BYTES + 1)
  if (!readBack || !CloudFormatSchema.safeParse(parseJson(readBack)).success) {
    throw unprocessable('The key can write to the bucket but not read from it. It needs both.')
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(fromUtf8(bytes))
  } catch {
    return null
  }
}
