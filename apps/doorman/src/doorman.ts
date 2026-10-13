import {
  DOORMAN_ERROR,
  DOORMAN_PATHS,
  DoormanError,
  type DoormanErrorCode,
  type DoormanHealth,
} from '@selfmp3/shared'
import { version as DOORMAN_VERSION } from '../package.json'
import { Access, access, type AccessCache } from './access.js'
import { Accounts, newAccountCache } from './accounts.js'
import * as auth from './auth.js'
import { BucketError, type BucketErrorKind, type Fetch } from './bucket.js'
import type { Context, Env, Log } from './context.js'
import { allowedOrigins, isForeignWrite, preflight, withCors } from './cors.js'
import * as files from './files.js'
import { grants } from './grants.js'
import { rooms } from './rooms.js'
import { shared } from './sharedRoutes.js'
import {
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

/** Keyed by packages/shared's `DOORMAN_PATHS`, the names every client asks by. */
const ROUTES: Readonly<Record<string, Readonly<Record<string, Route>>>> = {
  [DOORMAN_PATHS.health]: { GET: health },
  [DOORMAN_PATHS.signInStart]: { GET: auth.start },
  [DOORMAN_PATHS.signInCallback]: { GET: auth.callback },
  [DOORMAN_PATHS.claim]: { POST: auth.claim },
  [DOORMAN_PATHS.signOut]: { POST: auth.signOut },
  [DOORMAN_PATHS.signOutEverywhere]: { POST: auth.signOutEverywhere },
  [DOORMAN_PATHS.me]: { GET: storage.me },
  [DOORMAN_PATHS.access]: { GET: access, PUT: access },
  [DOORMAN_PATHS.storage]: { PUT: storage.connect, DELETE: storage.disconnect },
  [DOORMAN_PATHS.backblaze]: { POST: storage.connectBackblaze },
  [DOORMAN_PATHS.list]: { GET: files.list },
  [DOORMAN_PATHS.changes]: { GET: files.changes },
}

const { files: FILES, grants: GRANTS, rooms: ROOMS, shared: SHARED } = DOORMAN_PATHS

/** Errors from the bucket, as a device sees them: the doorman's own upstream failed. */
const BUCKET_CODES: Readonly<Record<BucketErrorKind, DoormanErrorCode>> = {
  auth: DOORMAN_ERROR.bucketRefusedKey,
  missing: DOORMAN_ERROR.noSuchBucket,
  network: DOORMAN_ERROR.bucketUnreachable,
  cap: DOORMAN_ERROR.bucketCapExceeded,
  other: DOORMAN_ERROR.bucketError,
}

export function createDoorman(deps: DoormanDeps = {}): Doorman {
  const fetcher: Fetch = deps.fetch ?? ((url, init) => fetch(url, init))
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? consoleLog
  const sessionCache: SessionCache = new Map()
  const accountCache = newAccountCache()
  const accessCache: AccessCache = new Map()
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
        access: new Access(env.KV, env.OWNER_EMAILS, now, accessCache),
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
      // A room's socket is answered by its Durable Object with headers that
      // cannot be changed, and a WebSocket is not a CORS request anyway.
      if (response.status !== 101) withCors(request, response, origins)
      return response
    },
  }
}

async function route(ctx: Context): Promise<Response> {
  const { request } = ctx
  const path = ctx.url.pathname
  if (!path.startsWith('/v1/')) throw notFound()
  if (request.method === 'OPTIONS') return preflight(request, ctx.origins)
  if (isForeignWrite(request, ctx.origins)) throw forbidden('this address may not use the doorman')

  if (path.startsWith(FILES)) return files.file(ctx, path.slice(FILES.length))
  if (path === GRANTS || path.startsWith(`${GRANTS}/`)) return grants(ctx)
  if (path === ROOMS || path.startsWith(`${ROOMS}/`)) return rooms(ctx)
  if (path === SHARED || path.startsWith(`${SHARED}/`)) return shared(ctx)

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
  return new DoormanError(500, DOORMAN_ERROR.internal, 'internal error')
}
