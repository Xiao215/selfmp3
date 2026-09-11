import {
  DoormanClaimResultSchema,
  DoormanMeSchema,
  ErrorBodySchema,
  newUid,
  type CloudConnect,
  type DoormanMe,
} from '@selfmp3/shared'
import { deleteStored, readStored, writeStored } from '../../offline/mirror.js'
import { BASE, DOORMAN_URL } from '../platform.js'

/**
 * Signed in to the doorman, from the web app (docs/SYNC.md).
 *
 * The session lives in IndexedDB rather than localStorage for one reason: the
 * service worker reads it too, to fetch a song from the bucket when the
 * player asks for one this device does not have yet.
 *
 * Signing in leaves the app for Google's page and comes back. An iPhone
 * home-screen app opens that page in a sheet of its own, whose storage is
 * not the app's — so the attempt is remembered here before leaving, and only
 * the app that remembers it claims the session. What claims it is the code
 * the doorman shows once Google has signed you in: read from the address on
 * coming back, or typed in where the page opened somewhere else.
 */

export const SESSION_KEY = 'cloud-session'
const PENDING_KEY = 'selfmp3.cloud.pending-sign-in'
/** As long as the doorman keeps an attempt. */
const ATTEMPT_LIFETIME_MS = 10 * 60_000

export interface CloudSession {
  readonly doormanUrl: string
  readonly token: string
  readonly me: DoormanMe
}

/** A doorman request that failed: 0 for no answer at all, else its status. */
export class DoormanError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, message: string, code = 'error') {
    super(message)
    this.name = 'DoormanError'
    this.status = status
    this.code = code
  }
}

export async function loadSession(): Promise<CloudSession | null> {
  try {
    const stored = (await readStored(SESSION_KEY)) as Partial<CloudSession> | null
    if (!stored || typeof stored.token !== 'string' || stored.doormanUrl !== DOORMAN_URL) {
      return null
    }
    const me = DoormanMeSchema.safeParse(stored.me)
    return me.success ? { doormanUrl: stored.doormanUrl, token: stored.token, me: me.data } : null
  } catch {
    return null
  }
}

export async function saveSession(session: CloudSession): Promise<void> {
  await writeStored(SESSION_KEY, session)
}

export async function forgetSession(): Promise<void> {
  try {
    await deleteStored(SESSION_KEY)
  } catch {
    // Nothing stored.
  }
}

// --- Signing in -------------------------------------------------------------------

interface PendingSignIn {
  readonly attempt: string
  readonly until: number
}

export function pendingSignIn(): PendingSignIn | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingSignIn>
    if (typeof parsed.attempt !== 'string' || typeof parsed.until !== 'number') return null
    return parsed.until > Date.now() ? { attempt: parsed.attempt, until: parsed.until } : null
  } catch {
    return null
  }
}

export function clearPendingSignIn(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // Private mode; nothing was stored.
  }
}

/**
 * Leave for Google's sign-in page, through the doorman, remembering the
 * attempt so this app can claim the session when it comes back — or when it
 * is brought back to the front, if the page opened somewhere else.
 */
export function beginSignIn(): void {
  // Only ever from the platform's cryptographic source: an attempt someone
  // could guess is a session someone could claim.
  const attempt = newUid(bytes => crypto.getRandomValues(bytes))
  const pending: PendingSignIn = { attempt, until: Date.now() + ATTEMPT_LIFETIME_MS }
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Without storage the app claims straight from the page it lands back on.
  }
  const params = new URLSearchParams({ attempt, return: `${window.location.origin}${BASE}` })
  window.location.assign(`${DOORMAN_URL}/v1/auth/start?${params.toString()}`)
}

export type ClaimOutcome =
  | { readonly status: 'pending' }
  | { readonly status: 'code' }
  | { readonly status: 'signed-in'; readonly session: CloudSession }

/**
 * Ask the doorman how a sign-in stands — `pending` until Google has finished,
 * then `code` — or, with the code it showed, claim the session and keep it.
 * A wrong code throws (`wrong_code`), and the attempt is over.
 */
export async function claimSignIn(attempt: string, code?: string): Promise<ClaimOutcome> {
  // Asking how it stands costs nothing and may be repeated.
  if (code === undefined) return claim(attempt)
  // A code may be spent once, so two goes at the same one are the same go:
  // React runs an effect twice in development, and a page may be opened again.
  const key = `${attempt}:${code}`
  const already = spending.get(key)
  if (already) return already
  const spend = claim(attempt, code).catch((error: unknown) => {
    // A refusal is final either way; no answer at all is worth another try.
    if (!(error instanceof DoormanError) || error.status === 0) spending.delete(key)
    throw error
  })
  spending.set(key, spend)
  return spend
}

const spending = new Map<string, Promise<ClaimOutcome>>()

async function claim(attempt: string, code?: string): Promise<ClaimOutcome> {
  const response = await doormanFetch(null, '/v1/auth/claim', {
    method: 'POST',
    json: code === undefined ? { attempt } : { attempt, code },
  })
  const result = DoormanClaimResultSchema.parse(await response.json())
  if (result.status !== 'signed-in') return result
  const session: CloudSession = { doormanUrl: DOORMAN_URL, token: result.token, me: result.me }
  await saveSession(session)
  clearPendingSignIn()
  return { status: 'signed-in', session }
}

/** What the doorman says about the account now; the stored session follows it. */
export async function refreshSession(session: CloudSession): Promise<CloudSession> {
  const response = await doormanFetch(session, '/v1/me')
  const next: CloudSession = { ...session, me: DoormanMeSchema.parse(await response.json()) }
  await saveSession(next)
  return next
}

/** Connect a bucket to the signed-in account. The doorman tries the key, then keeps it. */
export async function connectStorage(
  session: CloudSession,
  input: CloudConnect,
): Promise<CloudSession> {
  const response = await doormanFetch(session, '/v1/storage', { method: 'PUT', json: input })
  const next: CloudSession = { ...session, me: DoormanMeSchema.parse(await response.json()) }
  await saveSession(next)
  return next
}

export async function signOut(session: CloudSession): Promise<void> {
  try {
    await doormanFetch(session, '/v1/auth/signout', { method: 'POST' })
  } catch {
    // Forgotten here either way; the doorman lets the session lapse.
  }
  await forgetSession()
}

// --- Requests ---------------------------------------------------------------------

/**
 * A request to the doorman, with the session when there is one. A response
 * that is not ok becomes a `DoormanError` carrying the doorman's own message;
 * no answer at all becomes one with status 0, which the app reads as offline.
 */
export async function doormanFetch(
  session: CloudSession | null,
  path: string,
  options: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  if (!DOORMAN_URL) {
    throw new DoormanError(0, 'This web app is not connected to a doorman yet.', 'no-doorman')
  }
  const headers: Record<string, string> = { ...options.headers }
  if (session) headers['Authorization'] = `Bearer ${session.token}`
  if (options.json !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(`${DOORMAN_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
    })
  } catch (error) {
    throw new DoormanError(0, error instanceof Error ? error.message : 'network unavailable')
  }

  if (response.ok || response.status === 404) return response
  const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null))
  throw new DoormanError(
    response.status,
    parsed.success ? parsed.data.error : `the doorman answered ${response.status}`,
    parsed.success ? (parsed.data.code ?? 'error') : 'error',
  )
}
