import { z } from 'zod'
import { randomToken, sha256Hex } from './encoding.js'
import { getRecord, putRecord, type KvStore } from './kv.js'

/**
 * Signed-in devices.
 *
 * A session is a random token the device keeps and sends as
 * `Authorization: Bearer <token>`. KV holds only its SHA-256, so the list of
 * sessions cannot be used to sign in even by someone who can read it.
 *
 * A session lasts 180 days from sign-in, and that is fixed: sliding it
 * forward on use would cost a KV write per device per day, and the free plan
 * has about a thousand writes a day for everything.
 *
 * Looking a session up costs a KV read, so each Worker instance remembers the
 * ones it has seen for a minute. That minute is also the most a sign-out can
 * take to be felt by an instance that had the session in hand — no worse than
 * KV itself, which may take as long to tell other places about the delete.
 */

export const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60
const CACHE_MS = 60_000
const CACHE_LIMIT = 500

/** base64url of 32 random bytes. Anything else is not worth a KV read. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

export const SessionSchema = z.object({
  /** The Google account's id: stable, unlike its email address. */
  sub: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  createdAt: z.string(),
})
export type Session = z.infer<typeof SessionSchema>

export interface Identity {
  readonly sub: string
  readonly email: string
  readonly name: string | null
  readonly picture: string | null
}

export type SessionCache = Map<string, { session: Session; until: number }>

export class Sessions {
  readonly #kv: KvStore
  readonly #now: () => number
  readonly #cache: SessionCache

  constructor(kv: KvStore, now: () => number, cache: SessionCache) {
    this.#kv = kv
    this.#now = now
    this.#cache = cache
  }

  /** A new session for someone Google has just vouched for. Returns its token. */
  async create(identity: Identity): Promise<string> {
    const token = randomToken()
    const session: Session = {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
      createdAt: new Date(this.#now()).toISOString(),
    }
    await putRecord(this.#kv, await sessionKey(token), session, SESSION_TTL_SECONDS)
    return token
  }

  async find(token: string): Promise<Session | null> {
    if (!TOKEN.test(token)) return null
    const key = await sessionKey(token)
    const now = this.#now()
    const cached = this.#cache.get(key)
    if (cached && cached.until > now) return cached.session

    const session = await getRecord(this.#kv, key, SessionSchema)
    if (!session) {
      this.#cache.delete(key)
      return null
    }
    if (this.#cache.size >= CACHE_LIMIT) this.#cache.clear()
    this.#cache.set(key, { session, until: now + CACHE_MS })
    return session
  }

  /** Sign a device out. False when there was no such session to end. */
  async end(token: string): Promise<boolean> {
    if (!(await this.find(token))) return false
    const key = await sessionKey(token)
    this.#cache.delete(key)
    await this.#kv.delete(key)
    return true
  }
}

async function sessionKey(token: string): Promise<string> {
  return `session:${await sha256Hex(token)}`
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null
  return match?.[1] ?? null
}
