import { useMemo } from 'react'
import { useSettings } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { usePresenceConnection } from '../devices/presenceConnection'

/**
 * Whether smart features are on (Settings › Smart features), which is the
 * library's setting and so its server's. Asked of the server presence has
 * already found (`usePresenceConnection`) rather than gone looking for:
 * Search and Tags draw a way in by it, and a probe of their own every twenty
 * seconds is not worth a button. Until the settings arrive it counts as on,
 * which is the default: a way in that flickers out a moment after the page
 * draws is better than one that flickers in, and the server refuses smart
 * features while they are off either way.
 */
export function useSmartOn(): boolean {
  const server = usePresenceConnection()
  const api = useMemo(() => (server ? apiFor(server) : null), [server])
  const { data } = useSettings(api, server?.baseUrl ?? null)
  return data?.smartFeatures ?? true
}
