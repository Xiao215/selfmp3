import {
  BUCKET_CAP_CODE,
  CLOUD_SESSION_KEY,
  DOORMAN_ERROR,
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
/** Whose session the doorman ended, kept until the next sign-in (`EndedSession`). */
const ENDED_KEY = 'cloud-ended-session'
/**
 * Sessions signed out of while the doorman could not be reached, by token:
 * ended there once it answers again (`endLeftSessions`). Not forgotten with
 * the library, since a sign-out is what puts them here.
 */
const LEFT_KEY = 'cloud-left-sessions'

export interface CloudSession {
  readonly doormanUrl: string
  readonly token: string
  readonly me: DoormanMe
}

/**
 * A session the doorman refused: run out, signed out everywhere, or the
 * account taken off the list. The token is forgotten at once, and this is
 * what is kept instead: whose it was, so the next sign-in can tell whether
 * the library — and the changes made here that never went up — are its own.
 */
export interface EndedSession {
  readonly account: string
  readonly email: string
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
interface DoormanFetchOptions {
  method?: string
  json?: unknown
  headers?: Record<string, string>
  /**
   * Sent through a hold on that kind of call: the one request that finds out
   * whether it is over (`askBucketRead`), while the screens go on saying it
   * stands until the answer says otherwise.
   */
  asking?: boolean
}

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
  /**
   * End the session at the doorman, and forget it here. One the doorman
   * cannot be reached to end is kept, and ended once it answers
   * (`endLeftSessions`): it would otherwise go on working for months.
   */
  signOut: (session: CloudSession) => Promise<void>
  /** End at the doorman the sessions signed out of while it could not be reached. */
  endLeftSessions: () => Promise<void>
  /** The session the doorman last ended, until a sign-in or `clearEnded`. */
  endedSession: () => Promise<EndedSession | null>
  clearEnded: () => Promise<void>
  /**
   * Hear the doorman refuse this device's session (`EndedSession`), once per
   * session. Answers the way to stop listening.
   */
  onSessionEnded: (listener: (ended: EndedSession) => void) => () => void
  doormanFetch: (
    session: CloudSession | null,
    path: string,
    options?: DoormanFetchOptions,
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

  const endedListeners = new Set<(ended: EndedSession) => void>()
  /** Tokens already said to have ended: every request made with one is refused alike. */
  const endedTokens = new Set<string>()

  /**
   * The doorman refused the session: forget it, keep whose it was, and say so.
   * Only when it is still the stored one — a refusal of a token signed out
   * of meanwhile, or replaced by a new sign-in, ends nothing.
   */
  async function sessionRefused(session: CloudSession): Promise<void> {
    if (endedTokens.has(session.token)) return
    endedTokens.add(session.token)
    const stored = (await store.read(CLOUD_SESSION_KEY).catch(() => null)) as {
      token?: unknown
    } | null
    if (stored?.token !== session.token) return
    const ended: EndedSession = { account: session.me.account, email: session.me.email }
    await store.write(ENDED_KEY, ended).catch(() => undefined)
    await forgetSession()
    for (const listener of [...endedListeners]) listener(ended)
  }

  /**
   * A request to the doorman, with the session when there is one. A 404 is
   * answered rather than thrown — "no such file" is the caller's to read —
   * and every other refusal throws packages/shared's `DoormanError`.
   */
  async function doormanFetch(
    session: CloudSession | null,
    path: string,
    options: DoormanFetchOptions = {},
  ): Promise<CloudResponse> {
    const method = options.method ?? 'GET'
    // Refused for the day: a read of the bucket inside the hold is refused
    // here (packages/replica/src/hold.ts). Writes go — an upload is free of
    // the cap, and the outbox should empty — and so does anything the doorman
    // answers by itself. A listing and a read are held apart: Backblaze caps
    // each by itself. Which a request is, is shared's `bucketCallOf`, read off
    // the same paths the requests are built with.
    const call = bucketCallOf(method, path)
    const held = call && !options.asking ? bucketHold(call) : null
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
        holdBucket(error.message, call, Date.now(), options.asking)
      }
      noteDoormanAnswer({ bucket, write, error })
      // Only the doorman's own refusal of the session ends it: the same
      // answer to a request sent with none means nothing about this one.
      if (
        session &&
        error instanceof DoormanError &&
        error.status === 401 &&
        error.code === DOORMAN_ERROR.unauthorized
      ) {
        await sessionRefused(session)
      }
      throw error
    }
  }

  // A hold outlives a reload, as the refusal does (hold.ts, `keepHolds`).
  keepHolds(store)

  async function readLeft(): Promise<string[]> {
    const stored = await store.read(LEFT_KEY).catch(() => null)
    return Array.isArray(stored) ? stored.filter(token => typeof token === 'string') : []
  }

  /** Whether a sign-out reached the doorman, or could not and should be tried again. */
  async function endAtDoorman(token: string): Promise<'ended' | 'unreachable'> {
    try {
      await send(DOORMAN_PATHS.signOut, { method: 'POST', token })
      return 'ended'
    } catch (error) {
      // No answer, or the doorman having a moment: try again later. Any
      // other refusal means the session is over already.
      return error instanceof DoormanError && (error.status === 0 || error.status >= 500)
        ? 'unreachable'
        : 'ended'
    }
  }

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
      // Said ended before it is: the refusal of a request still under way is
      // this sign-out, not the doorman ending it.
      endedTokens.add(session.token)
      if ((await endAtDoorman(session.token)) === 'unreachable') {
        const left = await readLeft()
        if (!left.includes(session.token)) {
          await store.write(LEFT_KEY, [...left, session.token]).catch(() => undefined)
        }
      }
      await forgetSession()
    },

    async endLeftSessions(): Promise<void> {
      const left = await readLeft()
      if (left.length === 0) return
      const still: string[] = []
      for (const token of left) {
        if ((await endAtDoorman(token)) === 'unreachable') still.push(token)
      }
      // Read again: a sign-out while these were being sent may have added one.
      const now = await readLeft()
      const next = [...still, ...now.filter(token => !left.includes(token))]
      if (next.length > 0) await store.write(LEFT_KEY, next).catch(() => undefined)
      else await store.remove(LEFT_KEY).catch(() => undefined)
    },

    async endedSession(): Promise<EndedSession | null> {
      const stored = (await store.read(ENDED_KEY).catch(() => null)) as Partial<EndedSession> | null
      return typeof stored?.account === 'string' && typeof stored.email === 'string'
        ? { account: stored.account, email: stored.email }
        : null
    },

    async clearEnded(): Promise<void> {
      await store.remove(ENDED_KEY).catch(() => undefined)
    },

    onSessionEnded(listener: (ended: EndedSession) => void): () => void {
      endedListeners.add(listener)
      return () => {
        endedListeners.delete(listener)
      }
    },
  }
}
