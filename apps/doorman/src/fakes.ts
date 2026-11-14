import {
  DoormanClaimResultSchema,
  DoormanDriveStartedSchema,
  signInStartUrl,
} from '@selfmp3/shared'
import type { Fetch, FetchInit } from './store.js'
import type { Env } from './context.js'
import { createDoorman, type Doorman } from './doorman.js'
import { secureHex, toBase64, toBase64Url, utf8 } from './encoding.js'
import {
  APPLICATION_KEY,
  B2_ACCOUNT_API_HOST,
  B2_API_HOST,
  B2_HOST,
  BUCKET,
  FakeBackblaze,
  FakeBucket,
  KEY_ID,
  type SeenRequest,
} from './fakeBucket.js'
import { DRIVE_HOST, FakeDrive } from './fakeDrive.js'
import { FakeChanges, FakeRooms, FakeShared, FakeShares, FakeTally } from './fakeObjects.js'
import type { KvStore } from './kv.js'

/**
 * Stand-ins for everything the doorman talks to, for the tests: KV and
 * Google's token endpoint here, the bucket (fakeBucket.ts), Google Drive
 * (fakeDrive.ts) and the Durable Objects (fakeObjects.ts) beside it, each in memory, and a harness that
 * wires them to a doorman the way Cloudflare would.
 */

export const DOORMAN_ORIGIN = 'https://doorman.example'
export const APP_ORIGIN = 'https://xiao215.github.io'
export const CLIENT_ID = 'selfmp3-test.apps.googleusercontent.com'
export const CLIENT_SECRET = 'test-google-client-secret'

/** A clock the tests move by hand. */
export interface Clock {
  now: number
}

// --- KV ------------------------------------------------------------------------

/** KV in memory, with expiry by the test's clock. Counts reads and writes, as the free plan does. */
export class FakeKv implements KvStore {
  readonly #entries = new Map<string, { value: string; expires: number | null }>()
  /** Keys a test put there, which no listing of what the doorman wrote should show. */
  readonly #seeded = new Set<string>()
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

  /** A record the doorman finds already there, as if written long ago: not counted. */
  seed(key: string, value: unknown): void {
    this.#entries.set(key, { value: JSON.stringify(value), expires: null })
    this.#seeded.add(key)
  }

  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const ttl = options?.expirationTtl
    if (ttl !== undefined && ttl < 60) throw new Error('KV needs an expirationTtl of at least 60')
    this.writes++
    this.#seeded.delete(key)
    this.#entries.set(key, {
      value,
      expires: ttl === undefined ? null : this.#clock.now + ttl * 1000,
    })
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.writes++
    this.#seeded.delete(key)
    this.#entries.delete(key)
    return Promise.resolve()
  }

  /** Every live key the doorman wrote, with its value and when it expires. */
  dump(): Array<{ key: string; value: string; ttlSeconds: number | null }> {
    return [...this.#entries.entries()]
      .filter(([key]) => !this.#seeded.has(key))
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

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

/** What a trip to Google for Drive brings back besides the ID token. */
export interface DriveGrant {
  /** Left out, the person passed Google's page with the Drive box unticked. */
  readonly scope?: string
  /** Null for a Google that, against what was asked, sent no refresh token. */
  readonly refreshToken?: string | null
}

/**
 * Google's token endpoint: trades a code for an ID token with the claims the
 * test chose — but only with the PKCE verifier whose challenge the code was
 * issued for, as Google checks it. For a trip that asked for Google Drive it
 * gives a refresh token too, trades that for access tokens good for an hour,
 * and takes it back when told (`/revoke`).
 */
export class FakeGoogle {
  readonly #codes = new Map<
    string,
    { claims: Record<string, unknown>; challenge: string; drive: DriveGrant | null }
  >()
  /** Access tokens Google gave, and when each stops being good. */
  readonly #access = new Map<string, { refreshToken: string; until: number }>()
  readonly #clock: Clock
  #issued = 0
  /** Each exchange's form, as the doorman sent it. */
  readonly exchanges: URLSearchParams[] = []
  /** Refresh tokens still good: taken out when revoked, by the doorman or by a test. */
  readonly refreshTokens = new Set<string>()
  /** Every refresh token the doorman handed back. */
  readonly revoked: string[] = []
  /** How many access tokens were made from refresh tokens. */
  refreshes = 0
  refuse = false

  constructor(clock: Clock) {
    this.#clock = clock
  }

  /**
   * A code that Google will trade for an ID token carrying these claims, once,
   * for whoever holds the verifier of this PKCE challenge.
   */
  code(
    claims: Record<string, unknown>,
    challenge: string,
    drive: DriveGrant | null = null,
  ): string {
    const code = `4/0Abc-code-${++this.#issued}`
    this.#codes.set(code, { claims, challenge, drive })
    return code
  }

  /** Every access token given so far stops working, as when Google ends one early. */
  expireAccess(): void {
    this.#access.clear()
  }

  /** Whether Drive would take this access token now. */
  accepts(accessToken: string): boolean {
    const given = this.#access.get(accessToken)
    return (
      given !== undefined &&
      given.until > this.#clock.now &&
      this.refreshTokens.has(given.refreshToken)
    )
  }

  async handle(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text())
    if (new URL(request.url).pathname === '/revoke') {
      const token = form.get('token') ?? ''
      this.revoked.push(token)
      if (!this.refreshTokens.has(token)) {
        return Response.json({ error: 'invalid_token' }, { status: 400 })
      }
      // As Google does it: not the one token, but all the account gave this
      // app. The fake has one person a harness, so that is every token.
      this.refreshTokens.clear()
      return Response.json({})
    }
    this.exchanges.push(form)
    if (this.refuse) return Response.json({ error: 'server_error' }, { status: 500 })
    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
      return Response.json({ error: 'invalid_client' }, { status: 401 })
    }
    if (form.get('grant_type') === 'refresh_token') {
      const refreshToken = form.get('refresh_token') ?? ''
      if (!this.refreshTokens.has(refreshToken)) {
        return Response.json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          { status: 400 },
        )
      }
      return Response.json({
        access_token: this.#accessFor(refreshToken),
        expires_in: 3599,
        token_type: 'Bearer',
        scope: DRIVE_FILE_SCOPE,
      })
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
    const idToken = `${part({ alg: 'RS256', kid: 'test', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
    if (!issued.drive) {
      return Response.json({
        access_token: 'an-access-token-the-doorman-never-uses',
        expires_in: 3599,
        token_type: 'Bearer',
        scope: 'openid email profile',
        id_token: idToken,
      })
    }
    const refreshToken =
      issued.drive.refreshToken === undefined
        ? `1//0g-refresh-${this.#issued}`
        : issued.drive.refreshToken
    if (refreshToken !== null) this.refreshTokens.add(refreshToken)
    return Response.json({
      access_token: refreshToken === null ? 'ya29.unused' : this.#accessFor(refreshToken),
      expires_in: 3599,
      token_type: 'Bearer',
      scope: issued.drive.scope ?? `openid email ${DRIVE_FILE_SCOPE}`,
      id_token: idToken,
      ...(refreshToken === null ? {} : { refresh_token: refreshToken }),
    })
  }

  #accessFor(refreshToken: string): string {
    const token = `ya29.access-${++this.refreshes}`
    this.#access.set(token, { refreshToken, until: this.#clock.now + 3599_000 })
    return token
  }
}

// --- The harness -----------------------------------------------------------------

export interface Harness {
  readonly doorman: Doorman
  readonly env: { -readonly [Name in keyof Env]: Env[Name] }
  readonly kv: FakeKv
  readonly google: FakeGoogle
  readonly bucket: FakeBucket
  readonly backblaze: FakeBackblaze
  readonly drive: FakeDrive
  readonly changes: FakeChanges
  readonly rooms: FakeRooms
  readonly shared: FakeShared
  readonly shares: FakeShares
  readonly tally: FakeTally
  readonly clock: Clock
  /** Any other host a test puts on the internet: a room host's server, say. */
  readonly elsewhere: Map<string, (request: Request) => Response | Promise<Response>>
  /** Every request the doorman made to the outside, in order, with the options fetch was given. */
  readonly outside: Array<SeenRequest & { readonly init: FetchInit }>
  /** What the doorman wrote to its log, instead of the console. */
  readonly logs: Array<{ level: 'warn' | 'error'; message: string; details?: unknown }>
  /** Call the doorman as a device would. */
  call(path: string, init?: CallInit): Promise<Response>
  /** The work the doorman's answers left going on after them (`waitUntil`), finished. */
  settle(): Promise<void>
  /** Go through the whole of signing in, and return the session's token. */
  signIn(profile?: Partial<Profile>): Promise<string>
  /** Connect the test bucket, as the signed-in device. */
  connect(token: string, changes?: Record<string, unknown>): Promise<Response>
  /** Connect it from the key alone, the way the page after sign-in does. */
  connectBackblaze(token: string, changes?: Record<string, unknown>): Promise<Response>
  /**
   * Connect Google Drive, as the signed-in device and then the browser Google
   * sends back: the callback's answer. `as` is who says yes on Google's page,
   * the signed-in account unless a test says otherwise.
   */
  connectDrive(token: string, options?: ConnectDriveOptions): Promise<Response>
  /**
   * Who may sign in besides the owners, as an owner would have set it, and a
   * minute on, so every Worker instance has let go of the list it remembered.
   */
  allow(list: { anyone?: boolean; emails?: string[] }): void
}

export interface ConnectDriveOptions {
  readonly as?: Partial<Profile>
  readonly returnTo?: string | null
  readonly grant?: DriveGrant
  /** The Drive is asked for as somewhere to move the library to (move.ts). */
  readonly move?: boolean
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
  return secureHex(16)
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
  const google = new FakeGoogle(clock)
  const drive = new FakeDrive(accessToken => google.accepts(accessToken))
  const bucket = new FakeBucket()
  const backblaze = new FakeBackblaze()
  const changes = new FakeChanges()
  const rooms = new FakeRooms(clock)
  const shared = new FakeShared(clock)
  const shares = new FakeShares(clock)
  const tally = new FakeTally()
  const outside: Harness['outside'] = []
  const elsewhere: Harness['elsewhere'] = new Map()

  const internet: Fetch = async (address, init) => {
    const request = new Request(address, init)
    const url = new URL(request.url)
    outside.push({ method: request.method, url, headers: new Headers(request.headers), init })
    if (url.host === 'oauth2.googleapis.com') return google.handle(request)
    if (url.host === B2_HOST) return bucket.handle(request)
    if (url.host === DRIVE_HOST) return drive.handle(request)
    if (url.host === B2_API_HOST || url.host === B2_ACCOUNT_API_HOST) {
      return backblaze.handle(request)
    }
    const other = elsewhere.get(url.host)
    if (other) return other(request)
    throw new TypeError('fetch failed')
  }

  // The owner signs in as the owner; a friend is on the list the owner keeps.
  kv.seed('access', { anyone: false, emails: ['Friend@Example.com'] })
  const env: Harness['env'] = {
    KV: kv,
    CHANGES: changes.namespace(),
    ROOMS: rooms.namespace(),
    SHARED: shared.namespace(),
    SHARES: shares.namespace(),
    TALLY: tally.namespace(),
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
    SEAL_KEY,
    OWNER_EMAILS: 'Me@Example.com',
    APP_ORIGINS: `${APP_ORIGIN},http://localhost:4600`,
    APP_URL: `${APP_ORIGIN}/selfmp3/`,
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

  const background: Array<Promise<unknown>> = []
  const runtime = { waitUntil: (work: Promise<unknown>) => void background.push(work) }

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
    return doorman.fetch(new Request(`${DOORMAN_ORIGIN}${path}`, requestInit), env, runtime)
  }

  const settle = async (): Promise<void> => {
    while (background.length > 0) await Promise.all(background.splice(0))
  }

  const signIn = async (changes: Partial<Profile> = {}): Promise<string> => {
    const attempt = newAttempt()
    const start = await call(
      signInStartUrl(DOORMAN_ORIGIN, attempt, null).slice(DOORMAN_ORIGIN.length),
    )
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

  const connectBackblaze = (
    token: string,
    changes: Record<string, unknown> = {},
  ): Promise<Response> =>
    call('/v1/storage/backblaze', {
      method: 'POST',
      token,
      json: { keyId: KEY_ID, applicationKey: APPLICATION_KEY, ...changes },
    })

  const connectDrive = async (
    token: string,
    options: ConnectDriveOptions = {},
  ): Promise<Response> => {
    const started = await call('/v1/storage/drive', {
      token,
      json: { returnTo: options.returnTo ?? null, ...(options.move ? { move: true } : {}) },
    })
    if (!started.ok) return started
    const sentTo = new URL(DoormanDriveStartedSchema.parse(await started.json()).url)
    const code = google.code(
      idTokenClaims({ ...ME, ...options.as }, sentTo.searchParams.get('nonce') ?? '', clock),
      sentTo.searchParams.get('code_challenge') ?? '',
      options.grant ?? {},
    )
    const state = sentTo.searchParams.get('state') ?? ''
    return call(`/v1/auth/callback?state=${state}&code=${encodeURIComponent(code)}`)
  }

  return {
    doorman,
    env,
    kv,
    google,
    bucket,
    backblaze,
    drive,
    changes,
    rooms,
    shared,
    shares,
    tally,
    elsewhere,
    clock,
    outside,
    logs,
    call,
    settle,
    signIn,
    connect,
    connectBackblaze,
    connectDrive,
    allow: ({ anyone = false, emails = [] }) => {
      kv.seed('access', { anyone, emails })
      clock.now += 61_000
    },
  }
}
