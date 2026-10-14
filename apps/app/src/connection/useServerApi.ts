import { useMemo } from 'react'
import type { Api, Reach, ServerConnection } from '@selfmp3/client'
import { apiFor } from '../api/client'
import { useConnection } from './ConnectionProvider'
import { useServerDirect } from './useServerDirect'
import { reachedConnection } from './via'

export interface ServerApi {
  readonly reach: Reach & { readonly lookAgain: () => void }
  /** The server, once it answers. */
  readonly via: ServerConnection | undefined
  /** Asks it; null while it is being looked for or is away. */
  readonly api: Api | null
}

const nothing = (): void => undefined

/**
 * The library's server, for a screen that needs the server itself: the smart
 * features, and the settings only it acts on (Settings › Smart features,
 * Library, Importing).
 *
 * A cloud library reaches it directly, the way Import and Stats do
 * (`useServerDirect`), and says so when it cannot. A device that talks to a
 * server already has it, and it is always "reachable": that device's own
 * client says when it is not.
 *
 * `timeoutMs` is how long one answer may take, for the smart features, whose
 * answers take a model's time.
 */
export function useServerApi(timeoutMs?: number): ServerApi {
  const { fromCloud, connection } = useConnection()
  const direct = useServerDirect({ enabled: fromCloud })
  const reach = useMemo<ServerApi['reach']>(() => {
    if (fromCloud) return direct
    return connection
      ? { state: 'reachable', connection, lookAgain: nothing }
      : { state: 'away', said: false, lookAgain: nothing }
  }, [fromCloud, direct, connection])
  const via = reachedConnection(reach)
  const baseUrl = via?.baseUrl
  const token = via?.token ?? null
  const api = useMemo(
    () => (baseUrl === undefined ? null : apiFor({ baseUrl, token }, timeoutMs)),
    [baseUrl, token, timeoutMs],
  )
  return useMemo(() => ({ reach, via, api }), [reach, via, api])
}
