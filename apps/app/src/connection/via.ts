import type { Reach, ServerConnection } from '@selfmp3/client'
import { useConnection } from './ConnectionProvider'
import { useServerDirect } from './useServerDirect'

/**
 * Asking a server reached directly — from a cloud library, the server behind
 * it, found by its addresses (`useServerDirect`) — rather than whatever answers
 * this device. Stats, the Report, Import, a metadata lookup and the smart
 * features each ask that way; these are the pieces they all built by hand.
 */

/** The server a look found, or undefined while it is still looking or the server is away. */
export function reachedConnection(reach: Reach): ServerConnection | undefined {
  return reach.state === 'reachable' ? reach.connection : undefined
}

/**
 * The server to ask for the numbers only a server keeps — plays, history —
 * from a cloud library, while it can be reached. Undefined on a device that
 * talks to its own server, whose own client already answers, and undefined
 * while a cloud library's server is away, when that client is all there is.
 */
export function useVia(): ServerConnection | undefined {
  const { fromCloud } = useConnection()
  const reach = useServerDirect({ enabled: fromCloud })
  return fromCloud ? reachedConnection(reach) : undefined
}

/**
 * A query key for a question put to a server reached directly:
 * `['via-server', <address>, …]`. Every such query starts the same way, so
 * one invalidation of `viaKey(address)` reaches them all, and two screens
 * asking the same server the same question share one answer.
 */
export function viaKey(
  baseUrl: string | null | undefined,
  ...rest: readonly unknown[]
): readonly unknown[] {
  return ['via-server', baseUrl, ...rest]
}

/**
 * The query function a via-server query has while there is no server: such
 * a query is not `enabled` then, so this only answers a stray refetch.
 */
export function noServer(): Promise<never> {
  return Promise.reject(new Error('no server to ask'))
}
