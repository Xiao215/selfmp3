import {
  DoormanClaimResultSchema,
  DoormanMeSchema,
  ErrorBodySchema,
  newUid,
  type CloudConnect,
  type DoormanBackblazeConnect,
  type DoormanMe,
} from '@selfmp3/shared'
import type { CloudPlatform, CloudResponse } from './platform.js'

/**
 * Signed in to the doorman (docs/SYNC.md).
 *
 * Signing in leaves the app for Google's page and comes back. Where it comes
 * back to depends on the device: the same tab on a computer, and somewhere
 * else entirely on an iPhone home-screen app, which opens that page in a sheet
 * with storage of its own — or on a native app, which has no page to come back
 * to at all. So the attempt is remembered here before leaving, and only the
 * app that remembers it claims the session. What claims it is the code the
 * doorman shows once Google is done: read from the address on coming back, or
 * typed in where the page opened somewhere else.
 *
 * The session is kept in the platform's store rather than anywhere specific,
 * because on the web the service worker reads it too — to fetch a song from
 * the bucket when the player asks for one this device does not have yet.
 */

/** Also read by apps/app/sw/sw.ts, straight out of IndexedDB. Keep in step. */
export const SESSION_KEY = 'cloud-session'
const PENDING_KEY = 'cloud-pending-sign-in'
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

export interface PendingSignIn {
  readonly attempt: string
  readonly until: number
}

export type ClaimOutcome =
  | { readonly status: 'pending' }
  | { readonly status: 'code' }
  | { readonly status: 'signed-in'; readonly session: CloudSession }

/**
 * Written as properties rather than methods on purpose: these are closures
 * over one platform, and callers are meant to be free to take them apart. A
 * method type would promise a `this` that none of them has.
 */
export interface CloudSessionApi {
  loadSession: () => Promise<CloudSession | null>
  saveSession: (session: CloudSession) => Promise<void>
  forgetSession: () => Promise<void>
  pendingSignIn: () => Promise<PendingSignIn | null>
  clearPendingSignIn: () => Promise<void>
  beginSignIn: () => Promise<void>
  claimSignIn: (attempt: string, code?: string) => Promise<ClaimOutcome>
  refreshSession: (session: CloudSession) => Promise<CloudSession>
  connectStorage: (session: CloudSession, input: CloudConnect) => Promise<CloudSession>
  /** Connect a Backblaze bucket from its key alone: the doorman asks Backblaze for the rest. */
  connectBackblaze: (session: CloudSession, input: DoormanBackblazeConnect) => Promise<CloudSession>
  /** Forget the account's bucket. The bucket and its files are left alone. */
  disconnectStorage: (session: CloudSession) => Promise<CloudSession>
  signOut: (session: CloudSession) => Promise<void>
  doormanFetch: (
    session: CloudSession | null,
    path: string,
    options?: { method?: string; json?: unknown; headers?: Record<string, string> },
  ) => Promise<CloudResponse>
}

export function createCloudSession(
  platform: CloudPlatform,
  now = () => Date.now(),
): CloudSessionApi {
  const { doormanUrl, store } = platform

  /**
   * A code may be spent once, so two goes at the same one are the same go:
   * React runs an effect twice in development, and a page may be opened again.
   */
  const spending = new Map<string, Promise<ClaimOutcome>>()

  async function doormanFetch(
    session: CloudSession | null,
    path: string,
    options: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<CloudResponse> {
    if (!doormanUrl) {
      throw new DoormanError(0, 'This app is not connected to a doorman yet.', 'no-doorman')
    }
    const headers: Record<string, string> = { ...options.headers }
    if (session) headers['Authorization'] = `Bearer ${session.token}`
    if (options.json !== undefined) headers['Content-Type'] = 'application/json'

    let response: CloudResponse
    try {
      response = await platform.fetch(`${doormanUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
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

  async function saveSession(session: CloudSession): Promise<void> {
    await store.write(SESSION_KEY, session)
  }

  /** The doorman answers every change to the bucket with `/v1/me`; the stored session follows. */
  async function keepAnswer(session: CloudSession, response: CloudResponse): Promise<CloudSession> {
    const next: CloudSession = { ...session, me: DoormanMeSchema.parse(await response.json()) }
    await saveSession(next)
    return next
  }

  async function clearPendingSignIn(): Promise<void> {
    try {
      await store.remove(PENDING_KEY)
    } catch {
      // Nothing stored, or no storage at all.
    }
  }

  async function forgetSession(): Promise<void> {
    try {
      await store.remove(SESSION_KEY)
    } catch {
      // Nothing stored.
    }
  }

  async function claim(attempt: string, code?: string): Promise<ClaimOutcome> {
    const response = await doormanFetch(null, '/v1/auth/claim', {
      method: 'POST',
      json: code === undefined ? { attempt } : { attempt, code },
    })
    const result = DoormanClaimResultSchema.parse(await response.json())
    if (result.status !== 'signed-in') return result
    const session: CloudSession = { doormanUrl, token: result.token, me: result.me }
    await saveSession(session)
    await clearPendingSignIn()
    return { status: 'signed-in', session }
  }

  return {
    doormanFetch,
    saveSession,
    forgetSession,
    clearPendingSignIn,

    async loadSession(): Promise<CloudSession | null> {
      try {
        const stored = (await store.read(SESSION_KEY)) as Partial<CloudSession> | null
        // A session is the doorman's, and means nothing to any other — so a
        // build pointed somewhere new starts signed out rather than confused.
        if (!stored || typeof stored.token !== 'string' || stored.doormanUrl !== doormanUrl) {
          return null
        }
        const me = DoormanMeSchema.safeParse(stored.me)
        return me.success
          ? { doormanUrl: stored.doormanUrl, token: stored.token, me: me.data }
          : null
      } catch {
        return null
      }
    },

    async pendingSignIn(): Promise<PendingSignIn | null> {
      try {
        const parsed = (await store.read(PENDING_KEY)) as Partial<PendingSignIn> | null
        if (!parsed || typeof parsed.attempt !== 'string' || typeof parsed.until !== 'number') {
          return null
        }
        return parsed.until > now() ? { attempt: parsed.attempt, until: parsed.until } : null
      } catch {
        return null
      }
    },

    /**
     * Leave for Google's sign-in page, through the doorman, remembering the
     * attempt so this app can claim the session when it comes back — or when
     * it is brought back to the front, if the page opened somewhere else.
     */
    async beginSignIn(): Promise<void> {
      const attempt = newUid(bytes => platform.randomBytes(bytes))
      const pending: PendingSignIn = { attempt, until: now() + ATTEMPT_LIFETIME_MS }
      try {
        await store.write(PENDING_KEY, pending)
      } catch {
        // Without storage the app claims straight from the page it lands on.
      }
      // Built by hand rather than with URLSearchParams, which React Native's
      // URL does not carry. Both values are ours — a uid and a configured
      // address — but they are encoded anyway, because the day one of them
      // grows a character that matters is not the day to discover this.
      const query = [`attempt=${encodeURIComponent(attempt)}`]
      if (platform.returnUrl) query.push(`return=${encodeURIComponent(platform.returnUrl)}`)
      await platform.openSignIn(`${doormanUrl}/v1/auth/start?${query.join('&')}`)
    },

    /**
     * Ask the doorman how a sign-in stands — `pending` until Google has
     * finished, then `code` — or, with the code it showed, claim the session
     * and keep it. A wrong code throws (`wrong_code`), and the attempt is over.
     */
    async claimSignIn(attempt: string, code?: string): Promise<ClaimOutcome> {
      // Asking how it stands costs nothing and may be repeated.
      if (code === undefined) return claim(attempt)
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
    },

    /** What the doorman says about the account now; the stored session follows. */
    async refreshSession(session: CloudSession): Promise<CloudSession> {
      return keepAnswer(session, await doormanFetch(session, '/v1/me'))
    },

    /** Connect a bucket to the account. The doorman tries the key, then keeps it. */
    async connectStorage(session: CloudSession, input: CloudConnect): Promise<CloudSession> {
      const response = await doormanFetch(session, '/v1/storage', { method: 'PUT', json: input })
      return keepAnswer(session, response)
    },

    async connectBackblaze(
      session: CloudSession,
      input: DoormanBackblazeConnect,
    ): Promise<CloudSession> {
      const response = await doormanFetch(session, '/v1/storage/backblaze', {
        method: 'POST',
        json: input,
      })
      // A doorman from before this route answers 404, which `doormanFetch`
      // hands back as an answer. It is not one here: say what to do instead.
      if (response.status === 404) {
        throw new DoormanError(
          404,
          'The sign-in service needs updating before it can ask Backblaze. Enter the address yourself for now.',
          'no-route',
        )
      }
      return keepAnswer(session, response)
    },

    async disconnectStorage(session: CloudSession): Promise<CloudSession> {
      const response = await doormanFetch(session, '/v1/storage', { method: 'DELETE' })
      return keepAnswer(session, response)
    },

    async signOut(session: CloudSession): Promise<void> {
      try {
        await doormanFetch(session, '/v1/auth/signout', { method: 'POST' })
      } catch {
        // Forgotten here either way; the doorman lets the session lapse.
      }
      await forgetSession()
    },
  }
}
