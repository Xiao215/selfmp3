import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  candidates,
  clientApi,
  LOOK_AGAIN_MS,
  PROBE_TIMEOUT_MS,
  queryKeys,
  reachServerAgain,
  type Reach,
  type ServerConnection,
} from '@selfmp3/client'
import { fetchWithin } from '../api/client'
import { library as cloudLibrary } from '../replica'

/** The app's fetch with a deadline, at the probe's. */
const probeFetch = fetchWithin(PROBE_TIMEOUT_MS)

/**
 * `/api/health` at one address, within the deadline. It needs no token, and
 * an answer is all that is asked: what it says is the server's business.
 */
async function probe(connection: ServerConnection): Promise<boolean> {
  try {
    return (await probeFetch(`${connection.baseUrl}/api/health`)).ok
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

interface ServerDirectOptions {
  /**
   * Whether to look at all. False parks it: nothing is probed and nothing is
   * asked of this device's copy of the library. Presence turns it off while
   * this device is in the background with nothing playing.
   */
  readonly enabled?: boolean
  /**
   * How often to look again, or false to stop looking and keep what was found.
   * Presence passes false while its event stream is up — the stream is a
   * better liveness signal than a probe, and a free one.
   */
  readonly lookAgainMs?: number | false
}

/**
 * Whether the server behind this cloud library can be reached from here, and how
 * (@selfmp3/client reach.ts). Looks again every little while for as long as the
 * screen that asks is open, so a server switched on is found without a tap.
 *
 * Shared by every screen that needs the server itself — Import, Stats, a
 * metadata lookup — and by presence, rather than living with any one of them:
 * they all ask the same question, and two of these would probe the same
 * addresses twice. They share the query keys as well as the code, so a Stats
 * screen open beside a live device list is still one probe.
 */
export function useServerDirect(
  options: ServerDirectOptions = {},
): Reach & { readonly lookAgain: () => void } {
  const { enabled = true, lookAgainMs = LOOK_AGAIN_MS } = options
  const queryClient = useQueryClient()
  const server = useQuery({
    queryKey: queryKeys.cloudServer,
    queryFn: () => clientApi().cloudServer(),
    enabled,
    // Answered from this device's copy of the library: cheap, and the
    // addresses change when the server's next snapshot lands.
    refetchInterval: lookAgainMs,
  })
  const said = server.data?.server ?? null
  const addresses = said?.addresses ?? []

  // A server that was answering keeps its answer through one missed look
  // (reach.ts, CONFIRM_AWAY_MS): the query holds its last data while it asks
  // again, so the screen does not flash away for a network blip.
  const reachKey = [...queryKeys.cloudServer, 'reach', addresses]
  const reach = useQuery({
    queryKey: reachKey,
    queryFn: () =>
      reachServerAgain(
        candidates(said),
        probe,
        queryClient.getQueryData<ServerConnection | null>(reachKey),
        sleep,
      ),
    enabled: enabled && server.isSuccess,
    refetchInterval: lookAgainMs,
    retry: false,
    staleTime: 0,
  })

  /*
   * A tap asks the bucket, not just the addresses already known: the server was
   * started a moment ago and its snapshot, the first to name its addresses,
   * is not on this device yet. Stale makes the next read wait for a look.
   */
  const lookAgain = useCallback((): void => {
    cloudLibrary.markCloudLibraryStale()
    void queryClient.invalidateQueries({ queryKey: queryKeys.cloudServer })
  }, [queryClient])

  /*
   * One object for as long as the answer is the same one.
   *
   * A screen would not have minded a fresh one each render, but presence puts
   * this in a context that half the app reads, and a new object every render
   * would re-render all of them several times a second for an answer that
   * changes about once a minute.
   */
  const failed = server.isError
  const found = reach.data
  const named = addresses.length > 0
  return useMemo(() => {
    if (failed) return { state: 'away' as const, said: false, lookAgain }
    if (found === undefined) return { state: 'looking' as const, lookAgain }
    if (found === null) return { state: 'away' as const, said: named, lookAgain }
    return { state: 'reachable' as const, connection: found, lookAgain }
  }, [failed, found, named, lookAgain])
}
