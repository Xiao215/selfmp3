import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  clientApi,
  queryKeys,
  songIdTranslation,
  type ServerConnection,
  type SongIdTranslation,
} from '@selfmp3/client'
import { apiFor } from '../api/client'

/**
 * This device's song ids and a reached server's, lined up
 * (@selfmp3/client serverIds.ts).
 *
 * Both libraries answer `/api/cloud/uids` — this one from its copy of the
 * snapshot, the server from its database — and the uid is the name they share.
 * Without this a play in the stats would light up whichever song happened to
 * hold that number here, which is worse than showing none.
 *
 * Both lists change only when a library gains songs, so they are held for a
 * while rather than fetched per screen.
 */
export function useServerSongIds(via: ServerConnection | undefined): SongIdTranslation {
  const baseUrl = via?.baseUrl

  const mine = useQuery({
    queryKey: queryKeys.cloudUids('device'),
    queryFn: () => clientApi().cloudUids(),
    enabled: via !== undefined,
    staleTime: 60_000,
  })
  const theirs = useQuery({
    queryKey: queryKeys.cloudUids('via-server', baseUrl),
    queryFn: () => (via ? apiFor(via).cloudUids() : Promise.reject(new Error('no server to ask'))),
    enabled: via !== undefined,
    retry: false,
    staleTime: 60_000,
  })

  // A pass over both libraries; only a library gaining songs changes the answer.
  return useMemo(() => songIdTranslation(mine.data, theirs.data), [mine.data, theirs.data])
}
