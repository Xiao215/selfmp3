import {
  CloudServerSchema,
  DoormanGrantsSchema,
  type CloudServer,
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
 * The servers an account has let in are the doorman's to list and to take
 * back (`/v1/grants`): a grant removed stops the server's next look at the
 * bucket, and it lets the library go. That is how a device leaves one.
 */

const JOINED_KEY = 'selfmp3.cloud.joined-server'

/** What is kept: the server, and whose session joined it, so another account never uses it. */
const JoinedSchema = z.object({ email: z.string(), server: CloudServerSchema })

interface SharedServerApi {
  /** The server this account joined from this device, until a snapshot names one. */
  joined: (session: CloudSession) => Promise<CloudServer | null>
  join: (session: CloudSession) => Promise<CloudServer>
  grants: (session: CloudSession) => Promise<DoormanGrants>
  removeGrant: (session: CloudSession, id: string) => Promise<void>
}

export function createSharedServer(
  platform: CloudPlatform,
  sessionApi: CloudSessionApi,
): SharedServerApi {
  const base = platform.sharedServerUrl.replace(/\/+$/, '')

  async function joined(session: CloudSession): Promise<CloudServer | null> {
    try {
      const parsed = JoinedSchema.safeParse(await platform.store.read(JOINED_KEY))
      return parsed.success && parsed.data.email === session.me.email ? parsed.data.server : null
    } catch {
      return null
    }
  }

  async function join(session: CloudSession): Promise<CloudServer> {
    if (!base) throw new CloudRouteError(409, 'This app offers no shared computer.', 'no-server')
    const answer = await call(`${base}/api/hub/join`, 'POST', session.token)
    const server = CloudServerSchema.parse(answer)
    try {
      await platform.store.write(JOINED_KEY, { email: session.me.email, server })
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
    const response = await sessionApi.doormanFetch(session, `/v1/grants/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok && response.status !== 404) {
      throw new DoormanError(response.status, await errorOf(response))
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

  return { joined, join, grants, removeGrant }
}

/** The answer's own message, when it has one. */
async function errorOf(response: { json(): Promise<unknown> }): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : 'Something went wrong.'
}
