import type { Accounts, Account } from './accounts.js'
import { Bucket, type BucketDeps, type Fetch } from './bucket.js'
import { DoormanError, unauthorized } from './http.js'
import type { KvStore } from './kv.js'
import { bearerToken, type Session, type Sessions } from './sessions.js'

/**
 * What every route is handed: the request, the Worker's settings, and the
 * doorman's parts. Also the three gates a route may need to pass — a session,
 * the account behind it, and that account's bucket — so each route says which
 * it needs in one line and they are checked the same way everywhere.
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
  /** base64 of 32 random bytes. See seal.ts. */
  readonly SEAL_KEY?: string
  /** Comma-separated Google addresses that may sign in. Empty lets nobody in. */
  readonly ALLOWED_EMAILS?: string
  /** Comma-separated origins of the web app, for CORS and for going back after sign-in. */
  readonly APP_ORIGINS?: string
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
 * The session the request brings. Checked against ALLOWED_EMAILS every time,
 * so taking someone off the list signs them out everywhere at once rather
 * than when their 180 days are up.
 */
export async function requireSession(ctx: Context): Promise<Session> {
  const token = bearerToken(ctx.request)
  const session = token ? await ctx.sessions.find(token) : null
  if (!session) throw unauthorized()
  if (!isAllowed(session.email, ctx.env.ALLOWED_EMAILS)) {
    throw unauthorized('this Google account is no longer allowed on this self.mp3')
  }
  return session
}

/**
 * The session and its account. Every sign-in writes the account, so it is
 * only missing if someone deleted it from KV by hand; the session's own copy
 * of the name and picture stands in until the next sign-in.
 */
export async function requireAccount(
  ctx: Context,
): Promise<{ session: Session; account: Account }> {
  const session = await requireSession(ctx)
  const account = (await ctx.accounts.get(session.sub)) ?? {
    email: session.email,
    name: session.name,
    picture: session.picture,
    storage: null,
  }
  return { session, account }
}

/** The signed-in account's bucket, ready to use. */
export async function requireBucket(ctx: Context): Promise<Bucket> {
  const { session, account } = await requireAccount(ctx)
  const target = await ctx.accounts.bucket(session.sub, account)
  if (!target) throw new DoormanError(409, 'no_storage', 'connect your bucket first')
  return new Bucket(target, ctx.bucketDeps)
}
