import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clientApi, queryKeys, type ServerConnection } from '@selfmp3/client'
import { library as cloudLibrary } from '../../cloud'
import {
  candidates,
  LOOK_AGAIN_MS,
  PROBE_TIMEOUT_MS,
  reachMac,
  type Reach,
} from './macReach.model'

/**
 * `/api/health` at one address, within the deadline. It needs no token, and
 * an answer is all that is asked: what it says is the Mac's business.
 */
async function probe(connection: ServerConnection): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(`${connection.baseUrl}/api/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether the Mac behind this cloud library can be reached from here, and how
 * (macReach.model.ts). Looks again every little while for as long as the
 * screen that asks is open, so a Mac switched on is found without a tap.
 */
export function useMacDirect(): Reach & { readonly lookAgain: () => void } {
  const queryClient = useQueryClient()
  const server = useQuery({
    queryKey: queryKeys.cloudServer,
    queryFn: () => clientApi().cloudServer(),
    // Answered from this device's copy of the library: cheap, and the
    // addresses change when the Mac's next snapshot lands.
    refetchInterval: LOOK_AGAIN_MS,
  })
  const said = server.data?.server ?? null
  const addresses = said?.addresses ?? []

  const reach = useQuery({
    queryKey: [...queryKeys.cloudServer, 'reach', addresses],
    queryFn: () => reachMac(candidates(said), probe),
    enabled: server.isSuccess,
    refetchInterval: LOOK_AGAIN_MS,
    retry: false,
    staleTime: 0,
  })

  /*
   * A tap asks the bucket, not just the addresses already known: the Mac was
   * started a moment ago and its snapshot, the first to name its addresses,
   * is not on this device yet. Stale makes the next read wait for a look.
   */
  const lookAgain = (): void => {
    cloudLibrary.markCloudLibraryStale()
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudServer })
  }

  if (server.isError) return { state: 'away', said: false, lookAgain }
  if (reach.data === undefined) return { state: 'looking', lookAgain }
  if (reach.data === null) return { state: 'away', said: addresses.length > 0, lookAgain }
  return { state: 'reachable', connection: reach.data, lookAgain }
}
