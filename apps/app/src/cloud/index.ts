import { createCloudLibrary, createCloudRoutes, createCloudSession } from '@selfmp3/cloud'
import { nativePlatform } from '../ports/cloudPlatform'

/**
 * The phone's cloud client: the package, with a phone behind it.
 *
 * Built once here rather than per screen, because the replica is this device's
 * one copy of the library — two of them would keep two outboxes and hand out
 * the same log sequence number twice.
 */

export const session = createCloudSession(nativePlatform)
export const library = createCloudLibrary(nativePlatform, session)
export const { cloudRequest } = createCloudRoutes(nativePlatform, session, library)
export { nativePlatform }
