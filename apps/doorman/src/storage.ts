import {
  CLOUD_FORMAT,
  CloudConnectSchema,
  CloudFormatSchema,
  DoormanBackblazeConnectSchema,
  FORMAT_KEY,
  parseEndpoint,
  type CloudConnect,
  type CloudFormat,
} from '@selfmp3/shared'
import { z } from 'zod'
import { Bucket, BucketError, type BucketTarget } from './bucket.js'
import { requireSession, type Context } from './context.js'
import type { Session } from './sessions.js'
import { fromUtf8, toBase64, utf8 } from './encoding.js'
import { DoormanError, badRequest, json, readJson, unprocessable } from './http.js'

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
  await tryThenKeep(ctx, session, target)
  return json(await ctx.accounts.me(session))
}

/**
 * `POST /v1/storage/backblaze` — connect a Backblaze bucket from its key alone.
 *
 * The page after Google sign-in asks for two strings, the key ID and the
 * application key, and nothing else (docs/SYNC.md). Backblaze knows the rest:
 * a key made for one bucket names that bucket, and the account's S3 address
 * comes with the answer. From there it is `connect`: the key is tried against
 * the bucket, and only a key that passes is sealed and kept.
 */
export async function connectBackblaze(ctx: Context): Promise<Response> {
  const session = await requireSession(ctx)
  const input = await readJson(ctx.request, DoormanBackblazeConnectSchema)
  const found = await askBackblaze(ctx, input.keyId, input.applicationKey)
  const parsed = CloudConnectSchema.safeParse({
    endpoint: found.endpoint,
    bucket: found.bucket,
    keyId: input.keyId,
    applicationKey: input.applicationKey,
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
  })
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'not a bucket')
  await tryThenKeep(ctx, session, targetFrom(parsed.data, ctx.env.DEV === 'true'))
  return json(await ctx.accounts.me(session))
}

/** The key is tried against the bucket before anything is kept; a refusal is the bucket's own words. */
async function tryThenKeep(ctx: Context, session: Session, target: BucketTarget): Promise<void> {
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
}

/** Where Backblaze says what a key may do. Basic auth with the key itself; v4 groups the bucket under `allowed`. */
const B2_AUTHORIZE_URL = 'https://api.backblazeb2.com/b2api/v4/b2_authorize_account'

/** What `connect` needs of the answer. Everything else Backblaze says is left alone. */
const B2AuthorizeSchema = z.object({
  apiInfo: z.object({
    storageApi: z.object({
      s3ApiUrl: z.string(),
      allowed: z.object({
        capabilities: z.array(z.string()),
        /** The buckets a restricted key opens. Left out, or empty, for a key that opens them all. */
        buckets: z
          .array(z.object({ id: z.string(), name: z.string() }))
          .nullable()
          .optional(),
        namePrefix: z.string().nullable().optional(),
      }),
    }),
  }),
})

/** What the S3 side of a bucket has to be allowed for the doorman to list, read, write and clear it. */
const NEEDED = ['listFiles', 'readFiles', 'writeFiles', 'deleteFiles'] as const

/**
 * Ask Backblaze which bucket a key opens, and where. A key that opens every
 * bucket on the account is refused: the guidance everywhere is a key for one
 * bucket, and a master key in the doorman's keeping would be the whole
 * account's.
 */
async function askBackblaze(
  ctx: Context,
  keyId: string,
  applicationKey: string,
): Promise<{ endpoint: string; bucket: string }> {
  let response: Response
  try {
    response = await ctx.fetch(B2_AUTHORIZE_URL, {
      headers: { authorization: `Basic ${toBase64(utf8(`${keyId}:${applicationKey}`))}` },
    })
  } catch {
    throw new DoormanError(
      502,
      'bucket_unreachable',
      'Backblaze could not be reached. Try again in a moment.',
    )
  }
  if (response.status === 401) {
    throw unprocessable(
      'Backblaze does not know that key. Check the key ID and the application key, or make a new key.',
    )
  }
  if (!response.ok) {
    throw unprocessable(`Backblaze answered ${response.status}. Try again in a moment.`)
  }
  const parsed = B2AuthorizeSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    throw unprocessable('Backblaze answered in a way the doorman does not understand.')
  }
  const { s3ApiUrl, allowed } = parsed.data.apiInfo.storageApi
  const buckets = allowed.buckets ?? []
  if (buckets.length === 0) {
    throw unprocessable(
      'That key opens every bucket on the account. Make a key for one bucket, with read and write.',
    )
  }
  if (buckets.length > 1) {
    throw unprocessable(
      'That key opens more than one bucket. Make a key for the one bucket self.mp3 should use.',
    )
  }
  if (NEEDED.some(need => !allowed.capabilities.includes(need))) {
    throw unprocessable('The key needs Read and Write on the bucket. Make a new key with both.')
  }
  if (allowed.namePrefix) {
    throw unprocessable(
      'That key is limited to files whose names start a certain way. Make a key for the whole bucket.',
    )
  }
  return { endpoint: s3ApiUrl, bucket: buckets[0]?.name ?? '' }
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
