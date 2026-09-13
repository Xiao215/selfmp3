import type { ServerConnection } from '@selfmp3/client'

/**
 * The server this app was loaded from, if it was.
 *
 * A phone app is installed, not served, so there is never one: it asks for an
 * address, or signs in to the cloud.
 */
export function servedByServer(): Promise<ServerConnection | null> {
  return Promise.resolve(null)
}
