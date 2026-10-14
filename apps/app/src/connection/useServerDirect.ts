import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  askAddress,
  candidates,
  clientApi,
  LOOK_AGAIN_MS,
  PROBE_TIMEOUT_MS,
  queryKeys,
  reachServerAgain,
  type Reach,
  type ServerConnection,
} from '@selfmp3/client'
import type { CloudServer } from '@selfmp3/shared'
import { fetchWithin } from '../api/client'
import { library as cloudLibrary } from '../replica'

/** The app's fetch with a deadline, at the probe's. */
const probeFetch = fetchWithin(PROBE_TIMEOUT_MS)

/**
 * One address, within the deadline (`askAddress`): no token is sent until the
 * server there has said it is the one the snapshot named — on the computer you
 * develop on, `localhost` is the development server — and then the token is
 * asked about too, since that server may no longer work for this library.
 */
const probe = askAddress.bind(null, probeFetch)

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

  /*
   * The server the snapshot names answered as itself and refused this
   * library's token: it no longer works for the library, and cannot write a
   * snapshot that says so. This device's copy passes it over from now, and
   * says where the server is instead — none, or the shared one joined again
   * (sharedServer.ts in @selfmp3/replica).
   */
  const refused = useCallback(
    async (token: string): Promise<void> => {
      const now = await clientApi().cloudServerRefused(token)
      queryClient.setQueryData<{ server: CloudServer | null }>(queryKeys.cloudServer, now)
    },
    [queryClient],
  )

  // A server that was answering keeps its answer through one missed look
  // (reach.ts, CONFIRM_AWAY_MS): the query holds its last data while it asks
  // again, so the screen does not flash away for a network blip. The token is
  // in the key too: the shared server joined again is the same server at the
  // same addresses, with a new one, and is looked for at once.
  const reachKey = [
    ...queryKeys.cloudServer,
    'reach',
    said?.id ?? null,
    said?.token ?? null,
    addresses,
  ]
  const reach = useQuery({
    queryKey: reachKey,
    queryFn: async (): Promise<ServerConnection | null> => {
      const found = await reachServerAgain(
        candidates(said),
        probe,
        queryClient.getQueryData<ServerConnection | null>(reachKey),
        sleep,
      )
      if (found !== 'refused') return found
      // Not passed over, if this device's copy could not be told: the next look asks again.
      if (said?.token) await refused(said.token).catch(() => undefined)
      return null
    },
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
