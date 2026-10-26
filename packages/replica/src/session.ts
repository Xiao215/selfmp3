import {
  BUCKET_CAP_CODE,
  CLOUD_SESSION_KEY,
  DOORMAN_PATHS,
  DoormanClaimResultSchema,
  DoormanError,
  DoormanMeSchema,
  SIGN_IN_TTL_MS,
  bucketCallOf,
  doormanRequest,
  newUid,
  signInStartUrl,
  type CloudConnect,
  type DoormanBackblazeConnect,
  type DoormanMe,
} from '@selfmp3/shared'
import { bucketHold, holdBucket, keepHolds, releaseBucket } from './hold.js'
import type { CloudPlatform, CloudResponse } from './platform.js'
import { forgetDoormanTrouble, noteDoormanAnswer } from './reach.js'

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

/**
 * Where an attempt is kept while Google has the browser. The session's own key
 * is shared's `CLOUD_SESSION_KEY`, because apps/app/sw/sw.ts reads it too,
 * straight out of IndexedDB.
 */
const PENDING_KEY = 'cloud-pending-sign-in'

export interface CloudSession {
  readonly doormanUrl: string
  readonly token: string
  readonly me: DoormanMe
}

interface PendingSignIn {
  readonly attempt: string
  readonly until: number
}

type ClaimOutcome =
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

  /** Every request goes through packages/shared's one doorman client. */
  const send = doormanRequest(doormanUrl, platform.fetch)

  /**
   * A request to the doorman, with the session when there is one. A 404 is
   * answered rather than thrown — "no such file" is the caller's to read —
   * and every other refusal throws packages/shared's `DoormanError`.
   */
  async function doormanFetch(
    session: CloudSession | null,
    path: string,
    options: { method?: string; json?: unknown; headers?: Record<string, string> } = {},
  ): Promise<CloudResponse> {
    const method = options.method ?? 'GET'
    // Refused for the day: a read of the bucket inside the hold is refused
    // here (packages/replica/src/hold.ts). Writes go — an upload is free of
    // the cap, and the outbox should empty — and so does anything the doorman
    // answers by itself. A listing and a read are held apart: Backblaze caps
    // each by itself. Which a request is, is shared's `bucketCallOf`, read off
    // the same paths the requests are built with.
    const call = bucketCallOf(method, path)
    const held = call ? bucketHold(call) : null
    if (held) throw new DoormanError(502, BUCKET_CAP_CODE, held.message)
    // What the doorman passes on to the bucket, and of that what a refusal
    // for the day holds back: an edit, a play, a picture (reach.ts).
    const write = method !== 'GET' && method !== 'HEAD' && path.startsWith(DOORMAN_PATHS.files)
    const bucket = call !== null || write

    try {
      const response = await send(path, {
        method,
        token: session?.token ?? null,
        ...(options.json === undefined ? {} : { json: options.json }),
        ...(options.headers ? { headers: options.headers } : {}),
        allowStatus: [404],
      })
      if (call) releaseBucket(call)
      noteDoormanAnswer({ bucket, write, answer: true })
      return response
    } catch (error) {
      if (call && error instanceof DoormanError && error.code === BUCKET_CAP_CODE) {
        holdBucket(error.message, call)
      }
      noteDoormanAnswer({ bucket, write, error })
      throw error
    }
  }

  // A hold outlives a reload, as the refusal does (hold.ts, `keepHolds`).
  keepHolds(store)

  async function saveSession(session: CloudSession): Promise<void> {
    await store.write(CLOUD_SESSION_KEY, session)
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
    // A hold is the bucket's, and the doorman's trouble the account's; the
    // next sign-in may be to another.
    releaseBucket()
    forgetDoormanTrouble()
    try {
      await store.remove(CLOUD_SESSION_KEY)
    } catch {
      // Nothing stored.
    }
  }

  async function claim(attempt: string, code?: string): Promise<ClaimOutcome> {
    const response = await doormanFetch(null, DOORMAN_PATHS.claim, {
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
        const stored = (await store.read(CLOUD_SESSION_KEY)) as Partial<CloudSession> | null
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
      const pending: PendingSignIn = { attempt, until: now() + SIGN_IN_TTL_MS }
      try {
        await store.write(PENDING_KEY, pending)
      } catch {
        // Without storage the app claims straight from the page it lands on.
      }
      await platform.openSignIn(signInStartUrl(doormanUrl, attempt, platform.returnUrl || null))
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
      return keepAnswer(session, await doormanFetch(session, DOORMAN_PATHS.me))
    },

    /** Connect a bucket to the account. The doorman tries the key, then keeps it. */
    async connectStorage(session: CloudSession, input: CloudConnect): Promise<CloudSession> {
      const response = await doormanFetch(session, DOORMAN_PATHS.storage, {
        method: 'PUT',
        json: input,
      })
      return keepAnswer(session, response)
    },

    async connectBackblaze(
      session: CloudSession,
      input: DoormanBackblazeConnect,
    ): Promise<CloudSession> {
      const response = await doormanFetch(session, DOORMAN_PATHS.backblaze, {
        method: 'POST',
        json: input,
      })
      return keepAnswer(session, response)
    },

    async disconnectStorage(session: CloudSession): Promise<CloudSession> {
      const response = await doormanFetch(session, DOORMAN_PATHS.storage, { method: 'DELETE' })
      return keepAnswer(session, response)
    },

    async signOut(session: CloudSession): Promise<void> {
      try {
        await doormanFetch(session, DOORMAN_PATHS.signOut, { method: 'POST' })
      } catch {
        // Forgotten here either way; the doorman lets the session lapse.
      }
      await forgetSession()
    },
  }
}
