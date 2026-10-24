import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  DOORMAN_ERROR,
  DoormanError,
  type ShareAction,
  type ShareCreate,
  type ShareLink,
  type ShareSummary,
} from '@selfmp3/shared'
import { createShareApi } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { doormanUrl } from '../../ports/doormanUrl'
import { getDeviceId } from '../../ports/device'
import { session as cloudSession } from '../../replica'
import { plainFetch } from '../room/room.store'
import { countUse } from '../usage/usage'

/**
 * Share links, from this device (docs/features/share-links.md): the
 * doorman's API, and the queries every screen that shows them reads — the
 * link's page, Links you shared, and Home's From friends — so a link shared
 * again on one is seen on the next.
 */

export const shareApi = createShareApi(doormanUrl, plainFetch)

const KEY = ['share'] as const

/** The session to send when there is one: opening a link needs none. */
async function maybeSession(): Promise<string | null> {
  return (await cloudSession.loadSession().catch(() => null))?.token ?? null
}

async function session(): Promise<string> {
  const token = await maybeSession()
  if (!token) throw new DoormanError(401, DOORMAN_ERROR.unauthorized, 'sign in to share songs')
  return token
}

/** A link, as whoever opens it sees it: signed in, it is remembered among theirs. */
export function useShareLink(id: string | null, key: string | null): UseQueryResult<ShareLink> {
  const { status } = useConnection()
  return useQuery({
    queryKey: [...KEY, 'one', id],
    queryFn: async () => shareApi.open(await maybeSession(), id ?? '', key ?? '', getDeviceId()),
    enabled: id !== null && key !== null && status !== 'loading',
    staleTime: 60_000,
    // A play moves its end on, and it can end while the page is open.
    refetchInterval: 5 * 60_000,
    retry: false,
  })
}

/** The links you sent (F2), and the asks on them (F1). */
export function useSentLinks(): UseQueryResult<ShareSummary[]> {
  const { status, fromCloud } = useConnection()
  return useQuery({
    queryKey: [...KEY, 'sent'],
    queryFn: async () => shareApi.sent(await session()),
    enabled: status === 'ready' && fromCloud,
    staleTime: 60_000,
    // A friend's ask turns up without a pull.
    refetchInterval: 5 * 60_000,
  })
}

/** The links you opened signed in: Home's From friends. */
export function useReceivedLinks(): UseQueryResult<ShareSummary[]> {
  const { status, fromCloud } = useConnection()
  return useQuery({
    queryKey: [...KEY, 'received'],
    queryFn: async () => shareApi.received(await session()),
    enabled: status === 'ready' && fromCloud,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
  })
}

/** A new link of these songs. */
export async function createShareLink(input: ShareCreate): Promise<ShareLink> {
  const link = await shareApi.create(await session(), input)
  countUse('share-link')
  return link
}

/** Asking its sender for it again (F1): signed in as yourself, or with a name. */
export function useShareAsk(id: string, key: string): (name: string) => Promise<ShareLink> {
  const queryClient = useQueryClient()
  return useCallback(
    async (name: string) => {
      const next = await shareApi.ask(await maybeSession(), id, key, name)
      queryClient.setQueryData([...KEY, 'one', id], next)
      return next
    },
    [id, key, queryClient],
  )
}

/** Change a link: the sender's renew, end and dismiss, or anyone's forget. */
export function useShareAct(): (id: string, action: ShareAction) => Promise<ShareLink | null> {
  const queryClient = useQueryClient()
  return useCallback(
    async (id: string, action: ShareAction) => {
      const next = await shareApi.act(await session(), id, action)
      if (next) queryClient.setQueryData([...KEY, 'one', id], next)
      else queryClient.removeQueries({ queryKey: [...KEY, 'one', id] })
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'sent'] })
      void queryClient.invalidateQueries({ queryKey: [...KEY, 'received'] })
      return next
    },
    [queryClient],
  )
}

/** After a link is made: Links you shared, fresh. */
export function useShareMade(): () => void {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...KEY, 'sent'] })
  }, [queryClient])
}
