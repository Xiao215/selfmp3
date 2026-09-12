import type { Accounts } from './accounts.js'
import { Bucket, type BucketDeps, type Fetch } from './bucket.js'
import { DoormanError, unauthorized } from './http.js'
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
 * The Worker's settings: the KV binding, the public vars in wrangler.toml, and
 * the secrets set with `wrangler secret put`. The secrets are optional here
 * because a missing one has to become a message that says so, not a crash.
 */
export interface Env {
  readonly KV: KvStore
  readonly GOOGLE_CLIENT_ID?: string
  readonly GOOGLE_CLIENT_SECRET?: string
  /** base64 of 32 random bytes; every key the doorman uses comes from it. See keys.ts. */
  readonly SEAL_KEY?: string
  /** Comma-separated Google addresses that may sign in. Empty lets nobody in. */
  readonly ALLOWED_EMAILS?: string
  /** Comma-separated origins of the web app, for CORS and for going back after sign-in. */
  readonly APP_ORIGINS?: string
  /**
   * Comma-separated URL schemes of the native app, for going back after
   * sign-in — `selfmp3` unless a fork changed it in app.config.js. Never used
   * for CORS: a scheme has no origin to check one against.
   */
  readonly APP_SCHEMES?: string
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
  readonly bucketDeps: BucketDeps
}

/**
 * ALLOWED_EMAILS as a set of lower-cased addresses. Google addresses are not
 * case-sensitive, and what someone types into a secret may not match what
 * Google says letter for letter. An unset or empty list lets nobody in: the
 * doorman is never open by default.
 */
export function allowedEmails(value: string | undefined): ReadonlySet<string> {
  const emails = new Set<string>()
  for (const entry of (value ?? '').split(/[\s,]+/)) {
    if (entry) emails.add(entry.toLowerCase())
  }
  return emails
}

export function isAllowed(email: string, value: string | undefined): boolean {
  return allowedEmails(value).has(email.trim().toLowerCase())
}

/**
 * The session the request brings, if it is still good. Two things can end a
 * session before its 180 days are up, and both are checked every time:
 *
 * - its address is no longer on ALLOWED_EMAILS. That refuses the session
 *   while the address is off the list; putting it back revives it.
 * - the account signed out everywhere after the session was made. That ends
 *   it for good, and is what to do about a lost device.
 */
export async function requireSession(ctx: Context): Promise<Session> {
  const token = bearerToken(ctx.request)
  const session = token ? await ctx.sessions.find(token) : null
  if (!session) throw unauthorized()
  if (!isAllowed(session.email, ctx.env.ALLOWED_EMAILS)) {
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
  if (!target) throw new DoormanError(409, 'no_storage', 'connect your bucket first')
  return new Bucket(target, ctx.bucketDeps)
}
