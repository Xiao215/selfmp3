import { PRIVACY_POLICY_URL, type DoormanHealth } from '@selfmp3/shared'
import { version as DOORMAN_VERSION } from '../package.json'
import { Accounts, newAccountCache } from './accounts.js'
import * as auth from './auth.js'
import { BucketError, type BucketErrorKind, type Fetch } from './bucket.js'
import type { Context, Env, Log } from './context.js'
import { allowedOrigins, isForeignWrite, preflight, withCors } from './cors.js'
import * as files from './files.js'
import {
  DoormanError,
  errorResponse,
  forbidden,
  json,
  methodNotAllowed,
  notFound,
  notSetUp,
  redact,
} from './http.js'
import { deriveKeys, type DoormanKeys } from './keys.js'
import { Sessions, type SessionCache } from './sessions.js'
import * as storage from './storage.js'

/**
 * The doorman: one small Cloudflare Worker between every device and the
 * bucket — see docs/SYNC.md and the contract in packages/shared.
 *
 * It signs people in with Google and a one-time code (auth.ts, signin.ts),
 * keeps the one bucket that belongs to each Google account with its key
 * sealed (accounts.ts, seal.ts, keys.ts), and passes a signed-in device's
 * reads and writes through to that bucket (files.ts, bucket.ts). Devices
 * never hold the bucket's key.
 *
 * `createDoorman` builds it with what it talks to — fetch and a clock — so the
 * tests can run the very same code against a fake Google and a fake bucket.
 * What it builds lives as long as the Worker instance: a few caches, which
 * save KV reads and signing work between requests.
 */

interface DoormanDeps {
  /** How Google and the bucket are reached. The Worker's own fetch unless a test says otherwise. */
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly log?: Log
}

const consoleLog: Log = {
  warn: (message, details) => console.warn(message, details ?? {}),
  error: (message, details) => console.error(message, details ?? {}),
}

export interface Doorman {
  fetch(request: Request, env: Env): Promise<Response>
}

type Route = (ctx: Context) => Promise<Response>

const ROUTES: Readonly<Record<string, Readonly<Record<string, Route>>>> = {
  '/v1/health': { GET: health },
  '/v1/auth/start': { GET: auth.start },
  '/v1/auth/callback': { GET: auth.callback },
  '/v1/auth/claim': { POST: auth.claim },
  '/v1/auth/signout': { POST: auth.signOut },
  '/v1/auth/signout-everywhere': { POST: auth.signOutEverywhere },
  '/v1/me': { GET: storage.me },
  '/v1/storage': { PUT: storage.connect, DELETE: storage.disconnect },
  '/v1/list': { GET: files.list },
}

const FILES = '/v1/files/'

/** Errors from the bucket, as a device sees them: the doorman's own upstream failed. */
const BUCKET_CODES: Readonly<Record<BucketErrorKind, string>> = {
  auth: 'bucket_refused_key',
  missing: 'no_such_bucket',
  network: 'bucket_unreachable',
  other: 'bucket_error',
}

export function createDoorman(deps: DoormanDeps = {}): Doorman {
  const fetcher: Fetch = deps.fetch ?? ((url, init) => fetch(url, init))
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? consoleLog
  const sessionCache: SessionCache = new Map()
  const accountCache = newAccountCache()
  const signingKeys = new Map<string, ArrayBuffer>()
  let derived: { secret: string | undefined; keys: Promise<DoormanKeys> } | null = null

  /** SEAL_KEY's keys, derived once per instance. A missing or malformed one is the owner's to fix. */
  const getKeys = (env: Env): Promise<DoormanKeys> => {
    if (!derived || derived.secret !== env.SEAL_KEY) {
      derived = { secret: env.SEAL_KEY, keys: deriveKeys(env.SEAL_KEY) }
    }
    return derived.keys.catch((error: unknown) => {
      throw notSetUp(error instanceof Error ? error.message : 'SEAL_KEY is not usable.')
    })
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const origins = allowedOrigins(env.APP_ORIGINS, log)
      const keys = (): Promise<DoormanKeys> => getKeys(env)
      const ctx: Context = {
        request,
        url: new URL(request.url),
        env,
        fetch: fetcher,
        now,
        log,
        origins,
        keys,
        sessions: new Sessions(env.KV, now, sessionCache),
        accounts: new Accounts(env.KV, now, accountCache, keys, log),
        bucketDeps: { fetch: fetcher, now, signingKeys },
      }

      let response: Response
      try {
        response = await route(ctx)
      } catch (error) {
        response = errorResponse(asDoormanError(error, log))
      }
      if (request.method === 'HEAD' && response.body) {
        await response.body.cancel()
        response = new Response(null, { status: response.status, headers: response.headers })
      }
      withCors(request, response, origins)
      return response
    },
  }
}

/**
 * The privacy policy, outside /v1: a person reads it, no device calls it. It
 * is published beside the web app, where Google's consent screen points, so
 * the doorman sends whoever asks there rather than keeping a second copy.
 */
const PRIVACY = '/privacy'

async function route(ctx: Context): Promise<Response> {
  const { request } = ctx
  const path = ctx.url.pathname
  if (path === PRIVACY) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(['GET'])
    return new Response(null, { status: 308, headers: { Location: PRIVACY_POLICY_URL } })
  }
  if (!path.startsWith('/v1/')) throw notFound()
  if (request.method === 'OPTIONS') return preflight(request, ctx.origins)
  if (isForeignWrite(request, ctx.origins)) throw forbidden('this address may not use the doorman')

  if (path.startsWith(FILES)) return files.file(ctx, path.slice(FILES.length))

  // Own properties only: a request whose method is `constructor` or
  // `toString` must not find its way to Object.prototype.
  const methods = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined
  if (!methods) throw notFound()
  const handler = Object.hasOwn(methods, request.method) ? methods[request.method] : undefined
  if (handler) return handler(ctx)

  return methodNotAllowed(Object.keys(methods))
}

function health(): Promise<Response> {
  const body: DoormanHealth = { ok: true, version: DOORMAN_VERSION }
  return Promise.resolve(json(body))
}

function asDoormanError(error: unknown, log: Log): DoormanError {
  if (error instanceof DoormanError) return error
  if (error instanceof BucketError) {
    return new DoormanError(502, BUCKET_CODES[error.kind], error.message)
  }
  // Only the message, never a stack's worth of values, and with anything like
  // a credential taken out: an error can quote the header it choked on.
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  log.error('unexpected error', { message: redact(message).slice(0, 500) })
  return new DoormanError(500, 'internal', 'internal error')
}
