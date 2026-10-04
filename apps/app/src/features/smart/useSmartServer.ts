import { useMemo } from 'react'
import type { Api, Reach } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useServerSongIds } from '../../connection/useServerSongIds'

/**
 * How long a smart feature's answer may take. A model behind the claude CLI
 * starts a process per call and a describe makes two, so the usual fifteen
 * seconds, which mean "the server is asleep", would cut most answers off.
 */
const THINKING_MS = 240_000

interface SmartServer {
  readonly reach: Reach & { readonly lookAgain: () => void }
  /** Asks the server, or null until it is found and its songs are lined up with this device's. */
  readonly api: Api | null
  /** This device's id for a song the server numbers `serverId`. */
  readonly onDevice: (serverId: number) => number | undefined
  /** The server's id for a song this device numbers `songId`. */
  readonly onServer: (songId: number) => number | undefined
}

const same = (id: number): number => id
const nothing = (): void => undefined

/**
 * The server, for the smart features (docs/features/ai.md): the one thing
 * that holds the whole library and the model's address. A cloud library
 * reaches it the way Stats does and lines its song ids up with this device's;
 * a device talking to a server already has both.
 */
export function useSmartServer(): SmartServer {
  const { fromCloud, connection } = useConnection()
  const reach = useServerDirect({ enabled: fromCloud })
  const via = fromCloud
    ? reach.state === 'reachable'
      ? reach.connection
      : undefined
    : (connection ?? undefined)
  const ids = useServerSongIds(fromCloud ? via : undefined)
  const ready = via !== undefined && (!fromCloud || ids.ready)
  const api = useMemo(() => (ready && via ? apiFor(via, THINKING_MS) : null), [ready, via])

  return useMemo(() => {
    if (fromCloud) return { reach, api, onDevice: ids.onDevice, onServer: ids.onServer }
    const direct: SmartServer['reach'] = connection
      ? { state: 'reachable', connection, lookAgain: nothing }
      : { state: 'away', said: false, lookAgain: nothing }
    return { reach: direct, api, onDevice: same, onServer: same }
  }, [fromCloud, reach, api, ids.onDevice, ids.onServer, connection])
}
