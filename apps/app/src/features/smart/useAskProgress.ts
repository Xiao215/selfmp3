import { useMemo } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import type { AskProgress } from '@selfmp3/shared'
import { useSmartServer } from './useSmartServer'
import { reachedConnection, viaKey } from '../../connection/via'

/** A request's own name, for asking how it is going: unguessable, never reused. */
export function newTicket(): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `${Date.now().toString(36)}${random}`
}

/**
 * How a smart request named by `ticket` is going (`ai/progress.ts` on the
 * server), asked twice a second while `active`. Null until the first answer.
 */
export function useAskProgress(
  ticket: string | null,
  active: boolean,
): AskProgress['steps'] | null {
  const server = useSmartServer()
  const via = reachedConnection(server.reach)?.baseUrl ?? null
  const { api } = server
  const progress = useQuery({
    queryKey: viaKey(via, 'ai', 'ask-progress', ticket),
    queryFn: api && ticket !== null && active ? () => api.askProgress(ticket) : skipToken,
    refetchInterval: 500,
    retry: false,
  })
  return useMemo(() => (active ? (progress.data?.steps ?? null) : null), [active, progress.data])
}
