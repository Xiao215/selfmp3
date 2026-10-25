import { useMemo } from 'react'
import { useSettings } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { usePresenceConnection } from '../devices/presenceConnection'

/** Which smart features are on (Settings › Smart features). */
interface SmartSwitches {
  readonly ask: boolean
  readonly tidy: boolean
  readonly tags: boolean
  readonly written: boolean
  readonly metadata: boolean
  /** Import's review: the model reads the names of the songs coming in. */
  readonly import: boolean
}

/**
 * The switches, which are the library's settings and so its server's. Asked
 * of the server presence has already found (`usePresenceConnection`) rather
 * than gone looking for: Search and Tags draw a way in by these, and a probe
 * of their own every twenty seconds is not worth a button. Until the settings
 * arrive every feature counts as on, which is the default: a way in that
 * flickers out a moment after the page draws is better than one that flickers
 * in, and the server refuses a feature that is off either way.
 */
export function useSmartSwitches(): SmartSwitches {
  const server = usePresenceConnection()
  const api = useMemo(() => (server ? apiFor(server) : null), [server])
  const { data } = useSettings(api, server?.baseUrl ?? null)
  // "Use smart features" off turns every one of them off.
  const on = data?.smartFeatures ?? true
  return {
    ask: on && (data?.smartAsk ?? true),
    tidy: on && (data?.smartTidy ?? true),
    tags: on && (data?.smartTags ?? true),
    written: on && (data?.smartWritten ?? true),
    metadata: on && (data?.smartMetadata ?? true),
    import: on && (data?.smartImport ?? true),
  }
}
