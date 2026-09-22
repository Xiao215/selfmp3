import { z } from 'zod'
import { recall, remember, type BoundedCache } from './boundedCache.js'
import { randomToken, sha256Hex } from './encoding.js'
import { getRecord, putRecord, type KvStore } from './kv.js'

/**
 * Signed-in devices.
 *
 * A session is a random token the device keeps and sends as
 * `Authorization: Bearer <token>`. It is made when a device claims its
 * sign-in with the right code, and goes straight back to that device: KV
 * only ever holds its SHA-256, so the list of sessions cannot be used to sign
 * in even by someone who can read it. Using one also needs its address on
 * ALLOWED_EMAILS and a creation time after the account's last "sign out
 * everywhere" (see context.ts).
 *
 * A session lasts 180 days from sign-in, and that is fixed: sliding it
 * forward on use would cost a KV write per device per day, and the free plan
 * has about a thousand writes a day for everything.
 *
 * Looking a session up costs a KV read, so each Worker instance remembers the
 * ones it has seen (boundedCache.ts, which says for how long and why).
 */

const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60

/** base64url of 32 random bytes. Anything else is not worth a KV read. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

const SessionSchema = z.object({
  /** The Google account's id: stable, unlike its email address. */
  sub: z.string().min(1),
  email: z.string(),
  name: z.string().nullable(),
  picture: z.string().nullable(),
  /** Compared with the account's last "sign out everywhere". */
  createdAt: z.string().datetime(),
})
export type Session = z.infer<typeof SessionSchema>

export interface Identity {
  readonly sub: string
  readonly email: string
  readonly name: string | null
  readonly picture: string | null
}

export type SessionCache = BoundedCache<Session>

export class Sessions {
  readonly #kv: KvStore
  readonly #now: () => number
  readonly #cache: SessionCache

  constructor(kv: KvStore, now: () => number, cache: SessionCache) {
    this.#kv = kv
    this.#now = now
    this.#cache = cache
  }

  /** A new session for someone Google has vouched for, and its token. */
  async create(identity: Identity): Promise<{ token: string; session: Session }> {
    const token = randomToken()
    const session: Session = {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
      createdAt: new Date(this.#now()).toISOString(),
    }
    await putRecord(this.#kv, await sessionKey(token), session, SESSION_TTL_SECONDS)
    return { token, session }
  }

  async find(token: string): Promise<Session | null> {
    if (!TOKEN.test(token)) return null
    return this.#find(await sessionKey(token))
  }

  /** Sign a device out. False when there was no such session to end. */
  async end(token: string): Promise<boolean> {
    if (!TOKEN.test(token)) return false
    // One hash, for the lookup and the delete alike.
    const key = await sessionKey(token)
    if (!(await this.#find(key))) return false
    this.#cache.delete(key)
    await this.#kv.delete(key)
    return true
  }

  async #find(key: string): Promise<Session | null> {
    const now = this.#now()
    const cached = recall(this.#cache, key, now)
    if (cached) return cached

    const session = await getRecord(this.#kv, key, SessionSchema)
    if (!session) {
      this.#cache.delete(key)
      return null
    }
    remember(this.#cache, key, session, now)
    return session
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
