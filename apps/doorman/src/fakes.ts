import { DoormanClaimResultSchema } from '@selfmp3/shared'
import { AwsV4Signer } from 'aws4fetch'
import type { Fetch, FetchInit } from './bucket.js'
import type { Env } from './context.js'
import { createDoorman, type Doorman } from './doorman.js'
import { toBase64, toBase64Url, utf8 } from './encoding.js'
import type { KvStore } from './kv.js'

/**
 * Stand-ins for everything the doorman talks to, for the tests: KV, Google's
 * token endpoint and an S3 bucket, each in memory, and a harness that wires
 * them to a doorman the way Cloudflare would.
 *
 * The bucket answers the way S3 and B2 do — path-style keys, XML listings,
 * XML errors, ranges — and checks every request's signature against the
 * application key, as a real bucket would. So a test that passes has sent
 * requests a bucket would accept, not merely requests that look right.
 */

export const DOORMAN_ORIGIN = 'https://doorman.example'
export const APP_ORIGIN = 'https://xiao215.github.io'
export const CLIENT_ID = 'selfmp3-test.apps.googleusercontent.com'
export const CLIENT_SECRET = 'test-google-client-secret'
export const B2_HOST = 's3.us-west-004.backblazeb2.com'
export const BUCKET = 'my-music'
export const KEY_ID = '004abcdef0123456789'
export const APPLICATION_KEY = 'K004-test-application-key'

/** A clock the tests move by hand. */
export interface Clock {
  now: number
}

// --- KV ------------------------------------------------------------------------

/** KV in memory, with expiry by the test's clock. Counts reads and writes, as the free plan does. */
export class FakeKv implements KvStore {
  readonly #entries = new Map<string, { value: string; expires: number | null }>()
  readonly #clock: Clock
  reads = 0
  writes = 0

  constructor(clock: Clock) {
    this.#clock = clock
  }

  get(key: string): Promise<string | null> {
    this.reads++
    const entry = this.#entries.get(key)
    if (!entry) return Promise.resolve(null)
    if (entry.expires !== null && entry.expires <= this.#clock.now) {
      this.#entries.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(entry.value)
  }

  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl
    if (ttl !== undefined && ttl < 60) throw new Error('KV needs an expirationTtl of at least 60')
    this.writes++
    this.#entries.set(key, {
      value,
      expires: ttl === undefined ? null : this.#clock.now + ttl * 1000,
    })
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.writes++
    this.#entries.delete(key)
    return Promise.resolve()
  }

  /** Every live key, with its value and when it expires. */
  dump(): Array<{ key: string; value: string; ttlSeconds: number | null }> {
    return [...this.#entries.entries()]
      .filter(([, entry]) => entry.expires === null || entry.expires > this.#clock.now)
      .map(([key, entry]) => ({
        key,
        value: entry.value,
        ttlSeconds: entry.expires === null ? null : (entry.expires - this.#clock.now) / 1000,
      }))
  }

  keys(prefix = ''): string[] {
    return this.dump()
      .map(entry => entry.key)
      .filter(key => key.startsWith(prefix))
  }
}

// --- Google --------------------------------------------------------------------

/**
 * Google's token endpoint: trades a code for an ID token with the claims the
 * test chose — but only with the PKCE verifier whose challenge the code was
 * issued for, as Google checks it.
 */
export class FakeGoogle {
  readonly #codes = new Map<string, { claims: Record<string, unknown>; challenge: string }>()
  #issued = 0
  /** Each exchange's form, as the doorman sent it. */
  readonly exchanges: URLSearchParams[] = []
  refuse = false

  /**
   * A code that Google will trade for an ID token carrying these claims, once,
   * for whoever holds the verifier of this PKCE challenge.
   */
  code(claims: Record<string, unknown>, challenge: string): string {
    const code = `4/0Abc-code-${++this.#issued}`
    this.#codes.set(code, { claims, challenge })
    return code
  }

  async handle(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text())
    this.exchanges.push(form)
    if (this.refuse) return Response.json({ error: 'server_error' }, { status: 500 })
    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
      return Response.json({ error: 'invalid_client' }, { status: 401 })
    }
    const code = form.get('code') ?? ''
    const issued = this.#codes.get(code)
    if (!issued || form.get('grant_type') !== 'authorization_code') {
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    }
    const verifier = form.get('code_verifier') ?? ''
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier)))
    if (toBase64Url(digest) !== issued.challenge) {
      return Response.json(
        { error: 'invalid_grant', error_description: 'Invalid code verifier.' },
        { status: 400 },
      )
    }
    this.#codes.delete(code)
    const claims = issued.claims
    const part = (value: unknown): string => toBase64Url(utf8(JSON.stringify(value)))
    return Response.json({
      access_token: 'an-access-token-the-doorman-never-uses',
      expires_in: 3599,
      token_type: 'Bearer',
      scope: 'openid email profile',
      id_token: `${part({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`,
    })
  }
}

// --- The bucket ----------------------------------------------------------------

export interface StoredObject {
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

function s3Error(status: number, code: string, method: string): Response {
  return new Response(
    method === 'HEAD'
      ? null
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Error><Code>${code}</Code>` +
          `<Message>${code} (from the test bucket)</Message></Error>`,
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

// --- The harness -----------------------------------------------------------------

export interface Harness {
  readonly doorman: Doorman
  readonly env: { -readonly [Name in keyof Env]: Env[Name] }
  readonly kv: FakeKv
  readonly google: FakeGoogle
  readonly bucket: FakeBucket
  readonly clock: Clock
  /** Every request the doorman made to the outside, in order, with the options fetch was given. */
  readonly outside: Array<SeenRequest & { readonly init: FetchInit }>
  /** What the doorman wrote to its log, instead of the console. */
  readonly logs: Array<{ level: 'warn' | 'error'; message: string; details?: unknown }>
  /** Call the doorman as a device would. */
  call(path: string, init?: CallInit): Promise<Response>
  /** Go through the whole of signing in, and return the session's token. */
  signIn(profile?: Partial<Profile>): Promise<string>
  /** Connect the test bucket, as the signed-in device. */
  connect(token: string, changes?: Record<string, unknown>): Promise<Response>
}

export interface CallInit {
  readonly method?: string
  readonly token?: string
  readonly origin?: string
  readonly headers?: Record<string, string>
  readonly body?: BodyInit | null
  /** A body sent as JSON, with its Content-Type. */
  readonly json?: unknown
}

export interface Profile {
  readonly sub: string
  readonly email: string
  readonly name: string
  readonly picture: string
}

export const ME: Profile = {
  sub: '108234567890123456789',
  email: 'me@example.com',
  name: 'Xiao',
  picture: 'https://lh3.googleusercontent.com/a/me',
}

/** A fixed SEAL_KEY, so two harnesses can open each other's sealed values when a test wants that. */
export const SEAL_KEY = toBase64(new Uint8Array(32).map((_, index) => index * 7 + 1))

export function newAttempt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** What Google would put in an ID token for this person and this sign-in. */
export function idTokenClaims(
  profile: Profile,
  nonce: string,
  clock: Clock,
  changes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    azp: CLIENT_ID,
    aud: CLIENT_ID,
    sub: profile.sub,
    email: profile.email,
    email_verified: true,
    name: profile.name,
    picture: profile.picture,
    nonce,
    iat: Math.floor(clock.now / 1000),
    exp: Math.floor(clock.now / 1000) + 3600,
    ...changes,
  }
}

/**
 * The sign-in code the callback showed: on its page, or in the fragment of
 * the address it sent the browser back to. Null when it showed none.
 */
export async function signInCodeFrom(response: Response): Promise<string | null> {
  const location = response.headers.get('location')
  if (location) return /#signin-code=([0-9A-Z]{8})$/.exec(location)?.[1] ?? null
  const html = await response.clone().text()
  return /<p class="code">([0-9A-Z]{4})-([0-9A-Z]{4})<\/p>/.exec(html)?.slice(1, 3).join('') ?? null
}

export function harness(): Harness {
  const clock: Clock = { now: Date.parse('2026-09-11T12:00:00Z') }
  const kv = new FakeKv(clock)
  const google = new FakeGoogle()
  const bucket = new FakeBucket()
  const outside: Harness['outside'] = []

  const internet: Fetch = async (address, init) => {
    const request = new Request(address, init)
    const url = new URL(request.url)
    outside.push({ method: request.method, url, headers: new Headers(request.headers), init })
    if (url.host === 'oauth2.googleapis.com') return google.handle(request)
    if (url.host === B2_HOST) return bucket.handle(request)
    throw new TypeError('fetch failed')
  }

  const env: Harness['env'] = {
    KV: kv,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    SEAL_KEY,
    ALLOWED_EMAILS: 'me@example.com, Friend@Example.com',
    APP_ORIGINS: `${APP_ORIGIN},http://localhost:4600,app://selfmp3`,
  }
  const logs: Harness['logs'] = []
  const doorman = createDoorman({
    fetch: internet,
    now: () => clock.now,
    log: {
      warn: (message, details) => logs.push({ level: 'warn', message, details }),
      error: (message, details) => logs.push({ level: 'error', message, details }),
    },
  })

  const call = (path: string, init: CallInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    if (init.token) headers.set('authorization', `Bearer ${init.token}`)
    if (init.origin) headers.set('origin', init.origin)
    let body = init.body ?? null
    if (init.json !== undefined) {
      body = JSON.stringify(init.json)
      headers.set('content-type', 'application/json')
    }
    const requestInit: RequestInit & { duplex?: 'half' } = {
      method: init.method ?? (body === null ? 'GET' : 'POST'),
      headers,
      body,
    }
    // Node wants to be told a streamed body is sent before the answer comes.
    if (body instanceof ReadableStream) requestInit.duplex = 'half'
    return doorman.fetch(new Request(`${DOORMAN_ORIGIN}${path}`, requestInit), env)
  }

  const signIn = async (changes: Partial<Profile> = {}): Promise<string> => {
    const attempt = newAttempt()
    const start = await call(`/v1/auth/start?attempt=${attempt}`)
    const sentTo = new URL(start.headers.get('location') ?? 'about:blank')
    const code = google.code(
      idTokenClaims({ ...ME, ...changes }, sentTo.searchParams.get('nonce') ?? '', clock),
      sentTo.searchParams.get('code_challenge') ?? '',
    )
    const state = sentTo.searchParams.get('state') ?? ''
    const back = await call(`/v1/auth/callback?state=${state}&code=${encodeURIComponent(code)}`)
    const shown = await signInCodeFrom(back)
    if (!shown) throw new Error(`signing in failed: ${back.status}`)
    const claimed = await call('/v1/auth/claim', { json: { attempt, code: shown } })
    const result = DoormanClaimResultSchema.parse(await claimed.json())
    if (result.status !== 'signed-in') throw new Error('the sign-in was not there to claim')
    return result.token
  }

  const connect = (token: string, changes: Record<string, unknown> = {}): Promise<Response> =>
    call('/v1/storage', {
      method: 'PUT',
      token,
      json: {
        endpoint: B2_HOST,
        bucket: BUCKET,
        keyId: KEY_ID,
        applicationKey: APPLICATION_KEY,
        ...changes,
      },
    })

  return { doorman, env, kv, google, bucket, clock, outside, logs, call, signIn, connect }
}
