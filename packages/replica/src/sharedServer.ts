import {
  CloudServerSchema,
  DOORMAN_PATHS,
  DoormanGrantsSchema,
  type CloudServer,
  type DoormanGrants,
  refusalOf,
} from '@selfmp3/shared'
import { z } from 'zod'
import { CloudRouteError } from './errors.js'
import type { CloudPlatform } from './platform.js'
import type { CloudSession, CloudSessionApi } from './session.js'

/**
 * The server that works for anyone signed in (docs/features/shared-server.md),
 * from a device's side.
 *
 * Joining it hands it this device's doorman session once, and it answers with
 * the addresses and token this account's library there answers to. Those are
 * kept here until the bucket's snapshot names the server itself — which it
 * does within a minute or so of joining, and from then on is what every
 * device of the account reads, this one included.
 *
 * It happens by itself (`automatic`): a signed-in account with a bucket whose
 * snapshot names no server joins the shared one the first time anything asks
 * where the server is — no button, as Xiao asked (2026-10-12). Nothing about
 * the library leaves the account's bucket by it: the server works in that
 * bucket, through a grant the account can take back.
 *
 * The servers an account has let in are the doorman's to list and to take
 * back (`/v1/grants`): a grant removed stops the server's next look at the
 * bucket, and it lets the library go. That is how a device leaves one — and
 * this device then remembers it left, so it does not join again by itself.
 * Joining by hand forgets that.
 *
 * A server that let a library go cannot say so in the bucket: the grant it
 * would write with is the thing taken back. So the newest snapshot goes on
 * naming it, with a token it no longer takes, and only asking it shows that
 * (`askAddress` in @selfmp3/client, which the app reports here: `refused`).
 * A server that refused this library's token is passed over as if the
 * snapshot named none. Whether the shared one is then joined again depends on
 * why it refused. Taken back — on this device, or on another, which shows as
 * the account having no grant for it any more — counts as leaving it. Lost
 * some other way (its `hub.json` deleted, say), it is joined again, since
 * nobody asked it to stop.
 */

const JOINED_KEY = 'selfmp3.cloud.joined-server'
const LEFT_KEY = 'selfmp3.cloud.left-shared-server'
const REFUSED_KEY = 'selfmp3.cloud.refused-server'

/** How long a join that failed waits before the next is tried by itself. */
const RETRY_MS = 10 * 60_000

/**
 * How many refused tokens an account keeps, newest last. More than one: the
 * server the snapshot names and the shared one joined from here can both
 * refuse, and remembering only the latest would pass each over in turn — back
 * to the other at once, since the address looked for changes every time.
 */
const REFUSED_KEPT = 8

/** What is kept: the server, and whose session joined it, so another account never uses it. */
const JoinedSchema = z.object({ email: z.string(), server: CloudServerSchema })

/** Which account removed the shared server from this device. */
const LeftSchema = z.object({ email: z.string() })

/**
 * The tokens servers refused, and whose: those servers no longer work for this
 * library. Anything else kept under the key reads as none refused.
 */
const RefusedSchema = z.object({ email: z.string(), tokens: z.array(z.string()) })

interface SharedServerApi {
  /** The server this account joined from this device, until a snapshot names one. */
  joined: (session: CloudSession) => Promise<CloudServer | null>
  /**
   * The server to use: the one the snapshot names, else the one joined from
   * here, else the shared one, joined now — unless this account left it here,
   * has no bucket yet, or the last try failed a moment ago. Null for none. A
   * server that refused this library's token counts as none.
   */
  automatic: (session: CloudSession, named: CloudServer | null) => Promise<CloudServer | null>
  /**
   * The server this library's `token` is for refused it: it no longer works
   * for the library. Answers what `automatic` says now.
   */
  refused: (
    session: CloudSession,
    token: string,
    named: CloudServer | null,
  ) => Promise<CloudServer | null>
  join: (session: CloudSession) => Promise<CloudServer>
  grants: (session: CloudSession) => Promise<DoormanGrants>
  /** `named` is the server the snapshot names: passed over from now if it is the one removed. */
  removeGrant: (session: CloudSession, id: string, named: CloudServer | null) => Promise<void>
}

export function createSharedServer(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
): SharedServerApi {
  const base = platform.sharedServerUrl.replace(/\/+$/, '')
  /**
   * A join under way for each account, so the screens asking at once make one
   * — and an account signed into while another's join runs gets its own, not
   * the server the other one is handed.
   */
  const joining = new Map<string, Promise<CloudServer | null>>()
  /**
   * When a join that failed may be tried again by itself, for each account:
   * one account's failure does not hold back the next one signed in.
   */
  const nextTry = new Map<string, number>()

  async function joined(session: CloudSession): Promise<CloudServer | null> {
    try {
      const parsed = JoinedSchema.safeParse(await platform.store.read(JOINED_KEY))
      return parsed.success && parsed.data.email === session.me.email ? parsed.data.server : null
    } catch {
      return null
    }
  }

  async function left(session: CloudSession): Promise<boolean> {
    try {
      const parsed = LeftSchema.safeParse(await platform.store.read(LEFT_KEY))
      return parsed.success && parsed.data.email === session.me.email
    } catch {
      return false
    }
  }

  /** The tokens this account's library was refused with, newest last. */
  async function refusedTokens(session: CloudSession): Promise<string[]> {
    try {
      return tokensOf(session, await platform.store.read(REFUSED_KEY))
    } catch {
      return []
    }
  }

  /** What is kept under the key, read as this account's refused tokens. */
  function tokensOf(session: CloudSession, kept: unknown): string[] {
    const parsed = RefusedSchema.safeParse(kept)
    return parsed.success && parsed.data.email === session.me.email ? parsed.data.tokens : []
  }

  /**
   * Change this account's refused tokens. Another account's list, or anything
   * else kept under the key, is replaced rather than added to. Store failures
   * are the caller's to swallow.
   */
  async function changeRefused(
    session: CloudSession,
    change: (tokens: string[]) => string[],
  ): Promise<void> {
    await platform.store.update(REFUSED_KEY, current => ({
      email: session.me.email,
      tokens: change(tokensOf(session, current)).slice(-REFUSED_KEPT),
    }))
  }

  /** Remember that `token` was refused: not passed over twice, and kept the newest. */
  function addRefused(session: CloudSession, token: string): Promise<void> {
    return changeRefused(session, tokens => [...tokens.filter(kept => kept !== token), token])
  }

  async function automatic(
    session: CloudSession,
    named: CloudServer | null,
  ): Promise<CloudServer | null> {
    const gone = await refusedTokens(session)
    const works = (server: CloudServer): boolean =>
      server.token === null || !gone.includes(server.token)
    if (named && works(named)) return named
    const kept = await joined(session)
    if (kept && works(kept)) return kept
    const email = session.me.email
    if (!base || !session.me.storage || Date.now() < (nextTry.get(email) ?? 0)) return null
    if (await left(session)) return null
    let under = joining.get(email)
    if (!under) {
      under = takeOver(session, named !== null && isShared(named))
        .catch(() => {
          nextTry.set(email, Date.now() + RETRY_MS)
          return null
        })
        .finally(() => {
          joining.delete(email)
        })
      joining.set(email, under)
    }
    return under
  }

  /**
   * Join the shared server by itself — unless the snapshot names it and it
   * refused this library (`refusedShared`), and the account has no grant for
   * it any more: it was taken back on another device, and that counts as this
   * one having left it too. A grant still there means it lost the library
   * some other way, and nobody asked it to stop.
   */
  async function takeOver(
    session: CloudSession,
    refusedShared: boolean,
  ): Promise<CloudServer | null> {
    if (refusedShared) {
      const { grants: given } = await grants(session)
      if (!given.some(grant => sameAddress(grant.server, base))) {
        await platform.store.write(LEFT_KEY, { email: session.me.email })
        await platform.store.remove(JOINED_KEY)
        return null
      }
    }
    return join(session)
  }

  async function refused(
    session: CloudSession,
    token: string,
    named: CloudServer | null,
  ): Promise<CloudServer | null> {
    try {
      await addRefused(session, token)
    } catch {
      // No storage: the next look is refused again, and says so again.
    }
    return automatic(session, named)
  }

  /** Whether a server is the shared one: one of its addresses is. */
  function isShared(server: CloudServer): boolean {
    return base !== '' && server.addresses.some(address => sameAddress(address, base))
  }

  async function join(session: CloudSession): Promise<CloudServer> {
    if (!base) throw new CloudRouteError(409, 'This app offers no shared computer.', 'no-server')
    const answer = await call(`${base}/api/hub/join`, 'POST', session.token)
    const server = CloudServerSchema.parse(answer)
    try {
      await platform.store.write(JOINED_KEY, { email: session.me.email, server })
      await platform.store.remove(LEFT_KEY)
      // The token refused, answered again: it works for this library after all.
      // Only that one: the others stay passed over.
      const { token } = server
      if (token !== null && (await refusedTokens(session)).includes(token)) {
        await changeRefused(session, tokens => tokens.filter(kept => kept !== token))
      }
    } catch {
      // No storage: the snapshot naming the server brings it back soon anyway.
    }
    return server
  }

  async function grants(session: CloudSession): Promise<DoormanGrants> {
    const response = await sessionApi.doormanFetch(session, DOORMAN_PATHS.grants)
    if (!response.ok) throw await refusalOf(response)
    return DoormanGrantsSchema.parse(await response.json())
  }

  async function removeGrant(
    session: CloudSession,
    id: string,
    named: CloudServer | null,
  ): Promise<void> {
    const removed = (await grants(session)).grants.find(grant => grant.id === id)
    // A grant already gone is gone: `doormanFetch` answers its 404 rather than throwing.
    await sessionApi.doormanFetch(session, DOORMAN_PATHS.grant(id), { method: 'DELETE' })
    if (!removed) return
    // The grant is gone whatever happens next: a device with no storage only
    // forgets that it was, and the server's refusals then say so on the next look.
    try {
      // The server the snapshot names, taken back: passed over from now, not
      // from whenever it notices and starts refusing the token.
      if (named?.token && named.addresses.some(address => sameAddress(address, removed.server))) {
        await addRefused(session, named.token)
      }
      // The shared one, taken back: not joined again by itself from here.
      if (base && sameAddress(removed.server, base)) {
        await platform.store.write(LEFT_KEY, { email: session.me.email })
        await platform.store.remove(JOINED_KEY)
      }
    } catch {
      // No storage: see above.
    }
  }

  /** One request to the shared server, its refusals in its own words. */
  async function call(url: string, method: string, token: string): Promise<unknown> {
    let response
    try {
      response = await platform.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      throw new CloudRouteError(0, 'The shared computer is not answering.', 'offline')
    }
    if (!response.ok) {
      throw new CloudRouteError(response.status, await errorOf(response), 'shared-server')
    }
    return response.json()
  }

  return { joined, automatic, refused, join, grants, removeGrant }
}

/** Two ways of writing one address, whatever trailing slashes each has. */
function sameAddress(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

/** The answer's own message, when it has one. */
async function errorOf(response: { json(): Promise<unknown> }): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : 'Something went wrong.'
}
