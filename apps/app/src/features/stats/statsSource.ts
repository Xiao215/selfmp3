import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Song, Stats, StatsRange, Wrapped, WrappedRange } from '@selfmp3/shared'
import {
  STALE,
  HISTORY_PLAYS,
  useHistory,
  useStats,
  useWrapped,
  type Api,
  type ServerConnection,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useServerSongIds } from '../../connection/useServerSongIds'
import { useSongsById } from '../../ui/songsById'

/**
 * Where the numbers on Stats, the Report and Profile's month come from: whatever
 * answers this device, or — from a cloud library, with the server within
 * reach — that server directly.
 *
 * Stats are the server's and can be nobody else's. Every number here is worked
 * out from `play_events`, which the server keeps and the bucket does not carry:
 * a snapshot says a song has been played 41 times, never when. So a cloud
 * library asks the server itself (`useServerDirect`), the same way Import does.
 *
 * The answers then name songs by the server's ids, which mean nothing here, so
 * every list goes through `useStatsSongs` on the way to the screen. Nothing
 * else on Stats, the Report or Profile has to know which library answered.
 */
const noServer = (): Promise<never> => Promise.reject(new Error('no server to ask'))

/** `['via-server', <address>, …]`, the same shape the Import screen's queries use. */
const key = (via: ServerConnection | undefined, ...rest: readonly unknown[]) =>
  ['via-server', via?.baseUrl, ...rest] as const

/** What each of these hooks hands the screen, whichever library answered. */
interface Answer<T> {
  readonly data: T | undefined
  readonly isLoading: boolean
}

/**
 * This device's own answer (`own`, asked only without a server), or the same
 * question put to the server directly: what every hook below is.
 */
function useOwnOrVia<T>(
  via: ServerConnection | undefined,
  own: Answer<T>,
  rest: readonly unknown[],
  ask: (api: Api) => Promise<T>,
): Answer<T> {
  const server = useQuery({
    queryKey: key(via, ...rest),
    queryFn: () => (via ? ask(apiFor(via)) : noServer()),
    enabled: via !== undefined,
    retry: false,
    staleTime: STALE.minute,
  })
  const chosen = via ? server : own
  return { data: chosen.data, isLoading: chosen.isLoading }
}

export function useStatsFor(via: ServerConnection | undefined, range: StatsRange): Answer<Stats> {
  const own = useStats(range, via === undefined)
  return useOwnOrVia(via, own, ['stats', range], api => api.stats(range))
}

export function useWrappedFor(
  via: ServerConnection | undefined,
  range: WrappedRange,
): Answer<Wrapped> {
  const own = useWrapped(range, via === undefined)
  return useOwnOrVia(via, own, ['wrapped', range], api => api.wrapped(range))
}

export function useHistoryFor(via: ServerConnection | undefined) {
  const own = useHistory(via === undefined)
  return useOwnOrVia(via, own, ['history'], api => api.history(HISTORY_PLAYS))
}

/**
 * The song one of these numbers is about, as this device knows it — which is
 * what draws its cover and what plays when the line is tapped.
 *
 * Talking to the server directly, that means translating its id into this
 * device's (`useServerSongIds`). A song the two cannot line up — one the server
 * has never uploaded — has no answer, and the line shows its title without a
 * cover and does not play, which is what a song no longer in the library has
 * always done.
 */
export function useStatsSongs(
  via: ServerConnection | undefined,
): (songId: number) => Song | undefined {
  const byId = useSongsById()
  const ids = useServerSongIds(via)
  return useMemo(
    () => (songId: number) => {
      const here = via ? ids.onDevice(songId) : songId
      return here === undefined ? undefined : byId.get(here)
    },
    [byId, ids, via],
  )
}
