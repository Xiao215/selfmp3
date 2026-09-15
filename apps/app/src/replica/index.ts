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
