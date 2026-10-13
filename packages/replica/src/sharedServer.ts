import {
  CloudServerSchema,
  DoormanAccessSchema,
  DoormanGrantsSchema,
  type CloudServer,
  type DoormanAccess,
  type DoormanAccessUpdate,
  type DoormanGrants,
} from '@selfmp3/shared'
import { z } from 'zod'
import { CloudRouteError } from './errors.js'
import type { CloudPlatform } from './platform.js'
import { DoormanError, type CloudSession, type CloudSessionApi } from './session.js'

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
 */

const JOINED_KEY = 'selfmp3.cloud.joined-server'
const LEFT_KEY = 'selfmp3.cloud.left-shared-server'

/** How long a join that failed waits before the next is tried by itself. */
const RETRY_MS = 10 * 60_000

/** What is kept: the server, and whose session joined it, so another account never uses it. */
const JoinedSchema = z.object({ email: z.string(), server: CloudServerSchema })

/** Which account removed the shared server from this device. */
const LeftSchema = z.object({ email: z.string() })

interface SharedServerApi {
  /** The server this account joined from this device, until a snapshot names one. */
  joined: (session: CloudSession) => Promise<CloudServer | null>
  /**
   * The server to use: the one the snapshot names, else the one joined from
   * here, else the shared one, joined now — unless this account left it here,
   * has no bucket yet, or the last try failed a moment ago. Null for none.
   */
  automatic: (session: CloudSession, named: CloudServer | null) => Promise<CloudServer | null>
  join: (session: CloudSession) => Promise<CloudServer>
  grants: (session: CloudSession) => Promise<DoormanGrants>
  removeGrant: (session: CloudSession, id: string) => Promise<void>
  /** Who may sign in, for the doorman's owner; a 403 for anyone else. */
  access: (session: CloudSession) => Promise<DoormanAccess>
  updateAccess: (session: CloudSession, update: DoormanAccessUpdate) => Promise<DoormanAccess>
}

export function createSharedServer(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
): SharedServerApi {
  const base = platform.sharedServerUrl.replace(/\/+$/, '')
  /** A join under way, so the screens asking at once make one. */
  let joining: Promise<CloudServer | null> | null = null
  /** When a join that failed may be tried again by itself. */
  let nextTry = 0

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

  async function automatic(
    session: CloudSession,
    named: CloudServer | null,
  ): Promise<CloudServer | null> {
    if (named) return named
    const kept = await joined(session)
    if (kept) return kept
    if (!base || !session.me.storage || Date.now() < nextTry || (await left(session))) return null
    joining ??= join(session)
      .catch(() => {
        nextTry = Date.now() + RETRY_MS
        return null
      })
      .finally(() => {
        joining = null
      })
    return joining
  }

  async function join(session: CloudSession): Promise<CloudServer> {
    if (!base) throw new CloudRouteError(409, 'This app offers no shared computer.', 'no-server')
    const answer = await call(`${base}/api/hub/join`, 'POST', session.token)
    const server = CloudServerSchema.parse(answer)
    try {
      await platform.store.write(JOINED_KEY, { email: session.me.email, server })
      await platform.store.remove(LEFT_KEY)
    } catch {
      // No storage: the snapshot naming the server brings it back soon anyway.
    }
    return server
  }

  async function grants(session: CloudSession): Promise<DoormanGrants> {
    const response = await sessionApi.doormanFetch(session, '/v1/grants')
    if (!response.ok) throw new DoormanError(response.status, await errorOf(response))
    return DoormanGrantsSchema.parse(await response.json())
  }

  async function removeGrant(session: CloudSession, id: string): Promise<void> {
    const removed = (await grants(session)).grants.find(grant => grant.id === id)
    const response = await sessionApi.doormanFetch(session, `/v1/grants/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) {
      throw new DoormanError(response.status, await errorOf(response))
    }
    // The shared one, taken back: not joined again by itself from here.
    if (removed && base && removed.server.replace(/\/+$/, '') === base) {
      await platform.store.write(LEFT_KEY, { email: session.me.email })
      await platform.store.remove(JOINED_KEY)
    }
  }

  async function access(session: CloudSession): Promise<DoormanAccess> {
    const response = await sessionApi.doormanFetch(session, '/v1/access')
    if (!response.ok) throw new DoormanError(response.status, await errorOf(response))
    return DoormanAccessSchema.parse(await response.json())
  }

  async function updateAccess(
    session: CloudSession,
    update: DoormanAccessUpdate,
  ): Promise<DoormanAccess> {
    const response = await sessionApi.doormanFetch(session, '/v1/access', {
      method: 'PUT',
      json: update,
    })
    if (!response.ok) throw new DoormanError(response.status, await errorOf(response))
    return DoormanAccessSchema.parse(await response.json())
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

  return { joined, automatic, join, grants, removeGrant, access, updateAccess }
}

/** The answer's own message, when it has one. */
async function errorOf(response: { json(): Promise<unknown> }): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : 'Something went wrong.'
}
