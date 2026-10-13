import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  DOORMAN_ERROR,
  DoormanError,
  type SharedAction,
  type SharedPlaylist,
  type SharedSummary,
} from '@selfmp3/shared'
import { createSharedApi } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { doormanUrl } from '../../ports/doormanUrl'
import { session as cloudSession } from '../../replica'
import { plainFetch } from '../room/room.store'

/**
 * Shared playlists, from this device (docs/features/listen-together.md,
 * "Shared playlists"): the doorman's API, and the queries every screen that
 * shows them reads, so a change made on one page is seen on the next.
 */

export const sharedApi = createSharedApi(doormanUrl, plainFetch)

const KEY = ['shared'] as const

/** The session every shared playlist call is made with. */
export async function sharedSession(): Promise<string> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  if (!signedIn) {
    throw new DoormanError(401, DOORMAN_ERROR.unauthorized, 'sign in to share playlists')
  }
  return signedIn.token
}

/** The shared playlists you are in; nothing until this device is signed in. */
export function useSharedList(): UseQueryResult<SharedSummary[]> {
  const { status, fromCloud } = useConnection()
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: async () => sharedApi.list(await sharedSession()),
    enabled: status === 'ready' && fromCloud,
    staleTime: 30_000,
  })
}

export function useSharedPlaylist(id: string | null): UseQueryResult<SharedPlaylist> {
  const { status } = useConnection()
  return useQuery({
    queryKey: [...KEY, 'one', id],
    queryFn: async () => sharedApi.get(await sharedSession(), id ?? ''),
    enabled: id !== null && status === 'ready',
    staleTime: 15_000,
    // A friend's song added a moment ago turns up without a pull.
    refetchInterval: 30_000,
  })
}

/** Change a shared playlist; answers the playlist as it now is, null once you left it. */
export function useSharedAct(id: string): (action: SharedAction) => Promise<SharedPlaylist | null> {
  const queryClient = useQueryClient()
  return useCallback(
    async (action: SharedAction) => {
      const next = await sharedApi.act(await sharedSession(), id, action)
      if (next) queryClient.setQueryData([...KEY, 'one', id], next)
      else queryClient.removeQueries({ queryKey: [...KEY, 'one', id] })
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'list'] })
      return next
    },
    [id, queryClient],
  )
}

/** After a playlist is made or joined: the list and that playlist, fresh. */
export function useSharedChanged(): (playlist: SharedPlaylist) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (playlist: SharedPlaylist) => {
      queryClient.setQueryData([...KEY, 'one', playlist.id], playlist)
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'list'] })
    },
    [queryClient],
  )
}
