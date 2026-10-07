import { createCloudLibrary, createCloudRoutes, createCloudSession } from '@selfmp3/replica'
import { cloudPlatform } from '../ports/cloudPlatform'

/**
 * The cloud client: the package, with this device behind it (a phone, or a browser).
 *
 * Built once here rather than per screen, because the replica is this device's
 * one copy of the library — two of them would keep two outboxes and hand out
 * the same log sequence number twice.
 */

export const session = createCloudSession(cloudPlatform)
export const library = createCloudLibrary(cloudPlatform, session)
export const { cloudRequest } = createCloudRoutes(cloudPlatform, session, library)
export { cloudPlatform }

/** A file in the bucket, as the doorman serves it: `key` is where the bucket keeps it. */
export function doormanFileUrl(key: string): string {
  return `${cloudPlatform.doormanUrl}/v1/files/${key}`
}

/** The header the doorman reads, and the only thing it reads, to let a request through. */
export function doormanAuth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}
