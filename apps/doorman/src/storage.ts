import {
  CLOUD_FORMAT_UNREADABLE,
  CloudConnectSchema,
  DoormanBackblazeConnectSchema,
  FORMAT_KEY,
  cloudFormatProblem,
  formatZodError,
  isCloudFormat,
  newCloudFormatText,
  parseEndpoint,
  type CloudConnect,
} from '@selfmp3/shared'
import { z } from 'zod'
import { Bucket, BucketError, type BucketTarget } from './bucket.js'
import { requireSession, type Context } from './context.js'
import type { Session } from './sessions.js'
import { fromUtf8, toBase64, utf8 } from './encoding.js'
import { DoormanError, badRequest, isLoopbackHost, json, readJson, unprocessable } from './http.js'

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
 * comes with the answer. The bucket's lifecycle rules are read too, and a
 * bucket that keeps old versions is refused (`checkLifecycle`). From there it
 * is `connect`: the key is tried against the bucket, and only a key that
 * passes is sealed and kept.
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
  if (!parsed.success) throw badRequest(formatZodError(parsed.error))
  const target = targetFrom(parsed.data, ctx.env.DEV === 'true')
  await checkLifecycle(ctx, found, target.prefix)
  await tryThenKeep(ctx, session, target)
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
  accountId: z.string(),
  authorizationToken: z.string(),
  apiInfo: z.object({
    storageApi: z.object({
      apiUrl: z.string(),
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

/**
 * What a key has to be allowed: reading the bucket's settings, for its
 * lifecycle rules, and on the S3 side listing, reading, writing and clearing
 * it. A key made in Backblaze's web console for one bucket, with Read and
 * Write, has all five.
 */
const NEEDED = ['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'] as const

/** What Backblaze answered about a key: where its bucket is, and how to ask about the bucket. */
interface BackblazeKey {
  readonly endpoint: string
  readonly bucket: string
  readonly bucketId: string
  readonly accountId: string
  readonly apiUrl: string
  readonly token: string
}

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
): Promise<BackblazeKey> {
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
  const { apiUrl, s3ApiUrl, allowed } = parsed.data.apiInfo.storageApi
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
  return {
    endpoint: s3ApiUrl,
    bucket: buckets[0]?.name ?? '',
    bucketId: buckets[0]?.id ?? '',
    accountId: parsed.data.accountId,
    apiUrl,
    token: parsed.data.authorizationToken,
  }
}

/** One lifecycle rule as `b2_list_buckets` gives it. The fields the doorman judges by; the rest are left alone. */
const B2LifecycleRuleSchema = z.object({
  fileNamePrefix: z.string(),
  daysFromHidingToDeleting: z.number().nullable().optional(),
  daysFromUploadingToHiding: z.number().nullable().optional(),
})

const B2ListBucketsSchema = z.object({
  buckets: z.array(
    z.object({ bucketId: z.string(), lifecycleRules: z.array(B2LifecycleRuleSchema) }),
  ),
})

const WHAT_TO_SET =
  'In Backblaze, open the bucket’s Lifecycle Settings, choose “Keep only the last version of the file”, and connect again.'

/**
 * Refuse a bucket that would keep what the library deletes. B2 never deletes a
 * file by name: it hides it, and the old version stays — counted as stored —
 * until a lifecycle rule deletes it. A bucket made in the web console or the
 * API keeps every version unless told otherwise, so without the rule every
 * removed song, replaced cover and pruned snapshot would stay in the 10 GB for
 * good. A key for one bucket may not change the rule (`writeBuckets` is not
 * allowed on one), so the doorman can only check it and say how to set it.
 *
 * A rule whose prefix covers the library's folder and deletes hidden versions
 * after any number of days passes. A rule that hides files some days after
 * they are uploaded is refused as well, wherever in the folder it reaches: it
 * would hide songs the library still has.
 */
async function checkLifecycle(ctx: Context, key: BackblazeKey, prefix: string): Promise<void> {
  let response: Response
  try {
    response = await ctx.fetch(`${key.apiUrl}/b2api/v4/b2_list_buckets`, {
      method: 'POST',
      headers: { authorization: key.token, 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: key.accountId, bucketId: key.bucketId }),
    })
  } catch {
    throw new DoormanError(
      502,
      'bucket_unreachable',
      'Backblaze could not be reached. Try again in a moment.',
    )
  }
  if (!response.ok) {
    throw unprocessable(`Backblaze answered ${response.status}. Try again in a moment.`)
  }
  const parsed = B2ListBucketsSchema.safeParse(await response.json().catch(() => null))
  const bucket = parsed.data?.buckets.find(found => found.bucketId === key.bucketId)
  if (!bucket) {
    throw unprocessable('Backblaze answered in a way the doorman does not understand.')
  }

  const root = prefix ? `${prefix}/` : ''
  const covers = (rule: z.infer<typeof B2LifecycleRuleSchema>) =>
    root.startsWith(rule.fileNamePrefix)
  const reaches = (rule: z.infer<typeof B2LifecycleRuleSchema>) =>
    covers(rule) || rule.fileNamePrefix.startsWith(root)
  const rules = bucket.lifecycleRules
  if (rules.some(rule => reaches(rule) && rule.daysFromUploadingToHiding != null)) {
    throw unprocessable(
      `This bucket’s lifecycle rules hide files some days after they are uploaded, which would hide songs still in the library. ${WHAT_TO_SET}`,
    )
  }
  if (!rules.some(rule => covers(rule) && rule.daysFromHidingToDeleting != null)) {
    throw unprocessable(
      `This bucket keeps every old version of a file, so removed songs would go on filling it. ${WHAT_TO_SET}`,
    )
  }
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
  const local = isLoopbackHost(new URL(endpoint.url).hostname)
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
 * or there is none yet and this writes it — and reads it back. The rules and
 * the words are shared's (`cloudFormatProblem`), which the server's
 * `#checkFormat` judges by too.
 */
async function checkFormat(bucket: Bucket, now: () => number): Promise<void> {
  const existing = await bucket.read(FORMAT_KEY, FORMAT_MAX_BYTES + 1)
  if (existing) {
    // Far bigger than a format.json is not one, whatever it says.
    const document = existing.length <= FORMAT_MAX_BYTES ? parseJson(existing) : null
    const problem = cloudFormatProblem(document, 'the doorman')
    if (problem) throw unprocessable(problem)
    return
  }

  await bucket.write(
    FORMAT_KEY,
    utf8(newCloudFormatText(new Date(now()).toISOString(), 'doorman')),
    {
      contentType: 'application/json',
    },
  )
  const readBack = await bucket.read(FORMAT_KEY, FORMAT_MAX_BYTES + 1)
  if (!readBack || !isCloudFormat(parseJson(readBack))) {
    throw unprocessable(CLOUD_FORMAT_UNREADABLE)
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(fromUtf8(bytes))
  } catch {
    return null
  }
}
