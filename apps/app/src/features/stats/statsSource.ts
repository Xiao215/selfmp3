import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Song, Stats, StatsRange, Wrapped, WrappedRange } from '@selfmp3/shared'
import {
  useHistory,
  useLibrary,
  useStats,
  useWrapped,
  type ServerConnection,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useServerSongIds } from '../../connection/useServerSongIds'

/**
 * Where the numbers on Stats, the Report and You's month come from: whatever
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
 * else on Stats, the Report or You has to know which library answered.
 */
const noServer = (): Promise<never> => Promise.reject(new Error('no server to ask'))

/** `['via-server', <address>, …]`, the same shape the Import screen's queries use. */
const key = (via: ServerConnection | undefined, ...rest: readonly unknown[]) =>
  ['via-server', via?.baseUrl, ...rest] as const

export function useStatsFor(
  via: ServerConnection | undefined,
  range: StatsRange,
): { data: Stats | undefined; isLoading: boolean } {
  const own = useStats(range, via === undefined)
  const server = useQuery({
    queryKey: key(via, 'stats', range),
    queryFn: () => (via ? apiFor(via).stats(range) : noServer()),
    enabled: via !== undefined,
    retry: false,
    staleTime: 60_000,
  })
  const chosen = via ? server : own
  return { data: chosen.data, isLoading: chosen.isLoading }
}

export function useWrappedFor(
  via: ServerConnection | undefined,
  range: WrappedRange,
): { data: Wrapped | undefined; isLoading: boolean } {
  const own = useWrapped(range, via === undefined)
  const server = useQuery({
    queryKey: key(via, 'wrapped', range),
    queryFn: () => (via ? apiFor(via).wrapped(range) : noServer()),
    enabled: via !== undefined,
    retry: false,
    staleTime: 60_000,
  })
  const chosen = via ? server : own
  return { data: chosen.data, isLoading: chosen.isLoading }
}

export function useHistoryFor(via: ServerConnection | undefined) {
  const own = useHistory(via === undefined)
  const server = useQuery({
    queryKey: key(via, 'history'),
    queryFn: () => (via ? apiFor(via).history(200) : noServer()),
    enabled: via !== undefined,
    retry: false,
    staleTime: 60_000,
  })
  return { data: via ? server.data : own.data }
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
  const { data: library } = useLibrary()
  const ids = useServerSongIds(via)
  const byId = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  return useMemo(
    () => (songId: number) => {
      const here = via ? ids.onDevice(songId) : songId
      return here === undefined ? undefined : byId.get(here)
    },
    [byId, ids, via],
  )
}
