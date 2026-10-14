import { createContext, useContext } from 'react'
import type { ServerConnection } from '@selfmp3/client'

/**
 * The server presence talks to (`usePresenceServer`), once found: the one this
 * device has, or the one a cloud library reached. `DevicesProvider` provides
 * it; on its own, so that reading it does not pull in presence.
 */
export const PresenceConnection = createContext<ServerConnection | null>(null)

/**
 * The server presence has found, or null while it has found none — and outside
 * a `DevicesProvider`. For what is worth knowing whenever the server is in
 * reach and not worth going to look for (`useSmartSwitches`): presence is
 * already looking, so this costs no probe of its own.
 */
export function usePresenceConnection(): ServerConnection | null {
  return useContext(PresenceConnection)
}
