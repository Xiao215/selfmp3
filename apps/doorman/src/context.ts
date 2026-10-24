import type { Access } from './access.js'
import type { Accounts } from './accounts.js'
import { Bucket, type BucketDeps, type Fetch } from './bucket.js'
import { changeCounter, type ChangeCounter } from './changes.js'
import { DOORMAN_ERROR, DoormanError } from '@selfmp3/shared'
import { unauthorized } from './http.js'
import type { DoormanKeys } from './keys.js'
import type { KvStore } from './kv.js'
import { bearerToken, type Session, type Sessions } from './sessions.js'

/**
 * What every route is handed: the request, the Worker's settings, and the
 * doorman's parts. Also the two gates a route may need to pass — a session
 * that is still good, and the account's bucket — so each route says which it
 * needs in one line and they are checked the same way everywhere.
 */

/**
 * The Worker's settings: the KV and Durable Object bindings, the public vars
 * in wrangler.toml, and the secrets set with `wrangler secret put`. The
 * secrets are optional here because a missing one has to become a message that
 * says so, not a crash.
 */
export interface Env {
  readonly KV: KvStore
  /** Each account's change counter (changes.ts). */
  readonly CHANGES: DurableObjectNamespace
  /**
   * Listening rooms, one Durable Object per room code (room.ts). Optional:
   * without it, `/v1/rooms` answers 404.
   */
  readonly ROOMS?: DurableObjectNamespace
  /** Shared playlists, one Durable Object per playlist (shared.ts). Optional as ROOMS is. */
  readonly SHARED?: DurableObjectNamespace
  /** Share links, one Durable Object per link (share.ts). Optional as ROOMS is. */
  readonly SHARES?: DurableObjectNamespace
  readonly TALLY?: DurableObjectNamespace
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
  /** base64 of 32 random bytes; every key the doorman uses comes from it. See keys.ts. */
  readonly SEAL_KEY?: string
  /**
   * Comma-separated Google addresses that own this doorman: always let in,
   * and the only ones who may change who else is (access.ts).
   */
  readonly OWNER_EMAILS?: string
  /** Comma-separated origins of the web app, for CORS and for going back after sign-in. */
  readonly APP_ORIGINS?: string
  /**
   * Comma-separated URL schemes of the native app, for going back after
   * sign-in — `selfmp3` unless a fork changed it in app.config.js. Never used
   * for CORS: a scheme has no origin to check one against.
   */
  readonly APP_SCHEMES?: string
  /**
   * Where the web app is, path and all (`https://xiao215.github.io/selfmp3`):
   * where a share link's address sends a person on to (linkPage.ts). Unset,
   * the doorman answers no link addresses.
   */
  readonly APP_URL?: string
  /** "true" only in `wrangler dev --env dev`: allows a bucket on this computer, over http. */
  readonly DEV?: string
}

/**
 * Where the doorman says what went wrong, for its owner: the Worker's log
 * (`wrangler tail`, or the dashboard). Never a token, a key or a secret.
 */
export interface Log {
  warn(message: string, details?: Readonly<Record<string, unknown>>): void
  error(message: string, details?: Readonly<Record<string, unknown>>): void
}

export interface Context {
  readonly request: Request
  readonly url: URL
  readonly env: Env
  readonly fetch: Fetch
  readonly now: () => number
  readonly log: Log
  readonly origins: ReadonlySet<string>
  /** The keys derived from SEAL_KEY. Throws a not-set-up error when it is missing or wrong. */
  readonly keys: () => Promise<DoormanKeys>
  readonly sessions: Sessions
  readonly accounts: Accounts
  /** Who may sign in: the owners, and the list they keep. */
  readonly access: Access
  readonly bucketDeps: BucketDeps
  /**
   * Work that goes on after the answer is sent, such as telling a server its
   * grant was taken back (grants.ts). The runtime's `waitUntil`, so the
   * Worker is not stopped before it is done; the answer never waits on it.
   */
  readonly waitUntil: (work: Promise<unknown>) => void
}

/**
 * The session the request brings, if it is still good. Two things can end a
 * session before its 180 days are up, and both are checked every time:
 *
 * - its address is no longer allowed in (access.ts). That refuses the
 *   session while the address is off the list; putting it back revives it.
 * - the account signed out everywhere after the session was made. That ends
 *   it for good, and is what to do about a lost device.
 */
export async function requireSession(ctx: Context): Promise<Session> {
  const token = bearerToken(ctx.request)
  const session = token ? await ctx.sessions.find(token) : null
  if (!session) throw unauthorized()
  if (!(await ctx.access.allows(session.email))) {
    throw unauthorized('this Google account is no longer allowed on this self.mp3')
  }
  const cutoff = await ctx.accounts.sessionsValidAfter(session.sub)
  // Written so that a creation time that does not parse is refused too.
  if (cutoff !== null && !(Date.parse(session.createdAt) > cutoff)) {
    throw unauthorized('this session was signed out everywhere; sign in again')
  }
  return session
}

/** The signed-in account's bucket, ready to use. */
export async function requireBucket(ctx: Context, session: Session): Promise<Bucket> {
  const target = await ctx.accounts.bucket(session.sub)
  if (!target) throw new DoormanError(409, DOORMAN_ERROR.noStorage, 'connect your bucket first')
  return new Bucket(target, ctx.bucketDeps)
}

/** The signed-in account's change counter. */
export function changesOf(ctx: Context, session: Session): ChangeCounter {
  return changeCounter(ctx.env.CHANGES, session.sub)
}
