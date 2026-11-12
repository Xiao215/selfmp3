import { AwsV4Signer } from 'aws4fetch'
import { toBase64, utf8 } from './encoding.js'

/**
 * The bucket the doorman's tests run against (fakes.ts wires it in): an S3
 * bucket on B2 and Backblaze's own API, in memory.
 *
 * The bucket answers the way S3 and B2 do — path-style keys, XML listings,
 * XML errors, ranges — and checks every request's signature against the
 * application key, as a real bucket would. So a test that passes has sent
 * requests a bucket would accept, not merely requests that look right.
 */

export const B2_HOST = 's3.us-west-004.backblazeb2.com'
/** Where a key is asked what it opens (`b2_authorize_account`). */
export const B2_API_HOST = 'api.backblazeb2.com'
/** Where the account's own API lives once the key is known (`b2_list_buckets`). */
export const B2_ACCOUNT_API_HOST = 'api004.backblazeb2.com'
export const BUCKET = 'my-music'
export const KEY_ID = '004abcdef0123456789'
export const APPLICATION_KEY = 'K004-test-application-key'

interface StoredObject {
  readonly body: Uint8Array
  readonly contentType: string
  readonly contentEncoding: string | null
  readonly etag: string
}

export interface SeenRequest {
  readonly method: string
  readonly url: URL
  readonly headers: Headers
}

/** An S3 bucket on B2, in memory. */
export class FakeBucket {
  /** Full keys, prefix and all, as the bucket stores them. */
  readonly objects = new Map<string, StoredObject>()
  readonly requests: SeenRequest[] = []
  /** Keys listed per page; S3's own default is a thousand. */
  pageSize = 1000
  /** Headers that go missing on the way, as some do between Cloudflare and a bucket. */
  dropHeaders: string[] = []
  /** Keys a GET cannot see, as for a key that may write but not read. */
  readonly unreadable = new Set<string>()
  /** The application key was deleted in B2's console: every request is refused. */
  revoked = false
  /** The account's daily cap is used up: Backblaze refuses everything, as a 403. */
  capped = false
  /** Backblaze asks for fewer requests: everything is answered 503 SlowDown. */
  busy = false
  #etags = 0

  put(key: string, body: Uint8Array | string, options: Partial<StoredObject> = {}): void {
    this.objects.set(key, {
      body: typeof body === 'string' ? utf8(body) : body,
      contentType: options.contentType ?? 'application/octet-stream',
      contentEncoding: options.contentEncoding ?? null,
      etag: `"etag-${++this.#etags}"`,
    })
  }

  text(key: string): string | null {
    const object = this.objects.get(key)
    return object ? new TextDecoder().decode(object.body) : null
  }

  async handle(incoming: Request): Promise<Response> {
    const headers = new Headers(incoming.headers)
    for (const name of this.dropHeaders) headers.delete(name)
    const url = new URL(incoming.url)
    this.requests.push({ method: incoming.method, url, headers })

    if (this.capped) {
      return s3Error(403, 'AccessDenied', incoming.method, 'Transaction cap exceeded')
    }
    if (this.busy) {
      return s3Error(503, 'SlowDown', incoming.method, 'Please reduce your request rate.')
    }
    const refused = this.revoked
      ? 'InvalidAccessKeyId'
      : await verifySignature(incoming.method, url, headers)
    if (refused) return s3Error(403, refused, incoming.method)

    const [, bucket = '', ...rest] = url.pathname.split('/')
    if (bucket !== BUCKET) return s3Error(404, 'NoSuchBucket', incoming.method)
    const key = rest.map(part => decodeURIComponent(part)).join('/')

    if (incoming.method === 'GET' && key === '' && url.searchParams.get('list-type') === '2') {
      return this.#list(url.searchParams)
    }
    switch (incoming.method) {
      case 'PUT':
        return this.#put(key, incoming, headers)
      case 'GET':
      case 'HEAD':
        return this.#get(key, incoming.method, headers)
      case 'DELETE':
        this.objects.delete(key)
        return new Response(null, { status: 204 })
      default:
        return s3Error(405, 'MethodNotAllowed', incoming.method)
    }
  }

  #list(params: URLSearchParams): Response {
    const prefix = params.get('prefix') ?? ''
    const maxKeys = Math.min(Number(params.get('max-keys') ?? '1000'), this.pageSize)
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort()
    // The token names the key to start from, dressed up the way real tokens
    // look, with characters that must survive XML and a query string.
    const token = params.get('continuation-token')
    const start = token ? keys.indexOf(token.replace(/^next&page=/, '')) : 0
    const page = keys.slice(Math.max(start, 0), Math.max(start, 0) + maxKeys)
    const following = keys[Math.max(start, 0) + maxKeys]

    const contents = page
      .map(key => {
        const object = this.objects.get(key)
        return (
          `<Contents><Key>${escapeXml(key)}</Key><LastModified>2026-09-11T12:00:00.000Z` +
          `</LastModified><ETag>${escapeXml(object?.etag ?? '')}</ETag>` +
          `<Size>${object?.body.length ?? 0}</Size><StorageClass>STANDARD</StorageClass></Contents>`
        )
      })
      .join('')
    const more = following !== undefined
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        `<Name>${BUCKET}</Name><Prefix>${escapeXml(prefix)}</Prefix>` +
        `<KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` +
        `<IsTruncated>${more}</IsTruncated>` +
        (more
          ? `<NextContinuationToken>${escapeXml(`next&page=${following}`)}</NextContinuationToken>`
          : '') +
        `${contents}</ListBucketResult>`,
      { status: 200, headers: { 'content-type': 'application/xml' } },
    )
  }

  async #put(key: string, incoming: Request, headers: Headers): Promise<Response> {
    const body = new Uint8Array(await incoming.arrayBuffer())
    // S3 takes no upload without its length, and no chunked one.
    const length = headers.get('content-length')
    if (length === null) return s3Error(411, 'MissingContentLength', 'PUT')
    if (Number(length) !== body.length) return s3Error(400, 'IncompleteBody', 'PUT')
    this.put(key, body, {
      contentType: headers.get('content-type') ?? 'binary/octet-stream',
      contentEncoding: headers.get('content-encoding'),
    })
    return new Response(null, { status: 200, headers: { etag: this.objects.get(key)?.etag ?? '' } })
  }

  #get(key: string, method: string, headers: Headers): Response {
    const object = this.objects.get(key)
    if (!object || this.unreadable.has(key)) return s3Error(404, 'NoSuchKey', method)

    const base: Record<string, string> = {
      'content-type': object.contentType,
      etag: object.etag,
      'last-modified': 'Fri, 11 Sep 2026 12:00:00 GMT',
      'accept-ranges': 'bytes',
      'x-bz-file-id': '4_z-internal-id',
    }
    if (object.contentEncoding) base['content-encoding'] = object.contentEncoding
    if (headers.get('if-none-match') === object.etag) {
      return new Response(null, { status: 304, headers: { etag: object.etag } })
    }

    const size = object.body.length
    const range = headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      const first = match?.[1] ? Number(match[1]) : null
      const last = match?.[2] ? Number(match[2]) : null
      const start = first ?? (last !== null ? Math.max(size - last, 0) : NaN)
      const end = first !== null && last !== null ? Math.min(last, size - 1) : size - 1
      if (!match || Number.isNaN(start) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${size}`, 'content-type': 'application/xml' },
        })
      }
      const part = object.body.slice(start, end + 1)
      return new Response(method === 'HEAD' ? null : part, {
        status: 206,
        headers: {
          ...base,
          'content-length': String(part.length),
          'content-range': `bytes ${start}-${end}/${size}`,
        },
      })
    }
    return new Response(method === 'HEAD' ? null : object.body, {
      status: 200,
      headers: { ...base, 'content-length': String(size) },
    })
  }
}

/**
 * Check a request's SigV4 signature the way S3 does: rebuild the canonical
 * request from what arrived — method, path, query, and the signed headers'
 * values as they arrived — and sign it again with the application key. A
 * signed header that changed or went missing on the way fails here, as it
 * would at a real bucket. Returns S3's error code, or null when it is good.
 */
async function verifySignature(method: string, url: URL, headers: Headers): Promise<string | null> {
  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(
      headers.get('authorization') ?? '',
    )
  if (!match) return 'AccessDenied'
  const [, keyId = '', , region = '', signedHeaders = '', signature = ''] = match
  if (keyId !== KEY_ID) return 'InvalidAccessKeyId'

  const signed = new Headers()
  for (const name of signedHeaders.split(';')) {
    if (name === 'host') continue
    const value = headers.get(name)
    if (value === null) return 'SignatureDoesNotMatch'
    signed.set(name, value)
  }
  const signer = new AwsV4Signer({
    method,
    url: url.toString(),
    headers: signed,
    accessKeyId: keyId,
    secretAccessKey: APPLICATION_KEY,
    service: 's3',
    region,
    datetime: headers.get('x-amz-date') ?? '',
  })
  if (signer.signedHeaders !== signedHeaders) return 'SignatureDoesNotMatch'
  return (await signer.signature()) === signature ? null : 'SignatureDoesNotMatch'
}

function s3Error(
  status: number,
  code: string,
  method: string,
  message = `${code} (from the test bucket)`,
): Response {
  return new Response(
    method === 'HEAD'
      ? null
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Error><Code>${code}</Code>` +
          `<Message>${message}</Message></Error>`,
    { status, headers: { 'content-type': 'application/xml' } },
  )
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// --- Backblaze's own API -------------------------------------------------------

/**
 * `b2_authorize_account`, as B2's v4 answers it: Basic auth with the key,
 * and the bucket a restricted key opens under `apiInfo.storageApi.allowed`;
 * and `b2_list_buckets`, with the token that answer gave, for the one bucket
 * the key opens. A test changes what the key may do, and how the bucket keeps
 * old versions, by setting the fields.
 */
export class FakeBackblaze {
  keyId = KEY_ID
  applicationKey = APPLICATION_KEY
  /** The buckets the key opens, as B2 lists them; null for a key that opens them all. */
  buckets: Array<{ id: string; name: string }> | null = [{ id: 'b2id-my-music', name: BUCKET }]
  capabilities = [
    'listBuckets',
    'listFiles',
    'readFiles',
    'shareFiles',
    'writeFiles',
    'deleteFiles',
  ]
  namePrefix: string | null = null
  s3ApiUrl = `https://${B2_HOST}`
  /** The bucket's lifecycle rules. "Keep only the last version of the file", as SYNC.md says to set. */
  lifecycleRules: unknown[] = [
    { daysFromHidingToDeleting: 1, daysFromUploadingToHiding: null, fileNamePrefix: '' },
  ]

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.host === B2_ACCOUNT_API_HOST && url.pathname === '/b2api/v4/b2_list_buckets') {
      return this.#listBuckets(request)
    }
    if (url.host !== B2_API_HOST || url.pathname !== '/b2api/v4/b2_authorize_account') {
      return new Response('not found', { status: 404 })
    }
    const expected = `Basic ${toBase64(utf8(`${this.keyId}:${this.applicationKey}`))}`
    if (request.headers.get('authorization') !== expected) {
      return b2Json(
        {
          code: 'unauthorized',
          message: 'The applicationKeyId and/or the applicationKey are wrong.',
          status: 401,
        },
        401,
      )
    }
    return b2Json({
      accountId: 'acct-1234',
      authorizationToken: 'b2-auth-token',
      apiInfo: {
        storageApi: {
          apiUrl: `https://${B2_ACCOUNT_API_HOST}`,
          downloadUrl: 'https://f004.backblazeb2.com',
          s3ApiUrl: this.s3ApiUrl,
          allowed: {
            capabilities: this.capabilities,
            ...(this.buckets === null ? {} : { buckets: this.buckets }),
            namePrefix: this.namePrefix,
          },
        },
      },
    })
  }

  /**
   * One bucket, as B2 lists it: the token must be the one authorize gave and
   * carry listBuckets, and a key for one bucket must name that bucket.
   */
  async #listBuckets(request: Request): Promise<Response> {
    if (request.method !== 'POST' || request.headers.get('authorization') !== 'b2-auth-token') {
      return b2Json(
        { code: 'bad_auth_token', message: 'Invalid authorization token', status: 401 },
        401,
      )
    }
    const body = (await request.json().catch(() => null)) as {
      accountId?: unknown
      bucketId?: unknown
    } | null
    const bucket = this.buckets?.[0]
    if (
      !this.capabilities.includes('listBuckets') ||
      body?.accountId !== 'acct-1234' ||
      !bucket ||
      body.bucketId !== bucket.id
    ) {
      return b2Json({ code: 'unauthorized', message: 'not entitled', status: 401 }, 401)
    }
    return b2Json({
      buckets: [
        {
          accountId: 'acct-1234',
          bucketId: bucket.id,
          bucketName: bucket.name,
          bucketType: 'allPrivate',
          bucketInfo: {},
          corsRules: [],
          lifecycleRules: this.lifecycleRules,
          options: [],
          revision: 3,
        },
      ],
    })
  }
}

function b2Json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
