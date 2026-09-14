import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportQueue, Library, ToolStatus } from '@selfmp3/shared'
import { clientApi, queryKeys } from '@selfmp3/client'
import { apiFor, type ServerConnection } from '../../api/client'
import { useImportQueue, useImportTools, useLibrary } from '../../api/queries'

/**
 * Whom the Import screen talks to: whatever answers this device, or — from a
 * cloud library, with the Mac within reach — that Mac directly.
 *
 * The screen's own hooks ask whatever answers this device, which for a cloud
 * library is the bucket, and the bucket cannot read a link. A Mac reached
 * directly numbers its tags and playlists its own way, so its library is read
 * from it too, rather than from this device's copy, and what is queued names
 * the Mac's ids.
 */
export interface ImportSource {
  readonly api: ReturnType<typeof apiFor>
  readonly library: Library | undefined
  readonly tools: ToolStatus | undefined
  readonly refetchTools: () => Promise<unknown>
  readonly queue: ImportQueue | undefined
  readonly invalidateQueue: () => Promise<void>
  readonly invalidateLibrary: () => Promise<void>
}

export function useImportSource(via: ServerConnection | undefined): ImportSource {
  const baseUrl = via?.baseUrl
  const token = via?.token ?? null
  const mac = useMemo(
    () => (baseUrl === undefined ? null : apiFor({ baseUrl, token })),
    [baseUrl, token],
  )
  const keys = useMemo(
    () => ({
      library: ['via-mac', baseUrl, 'library'] as const,
      queue: ['via-mac', baseUrl, 'queue'] as const,
      tools: ['via-mac', baseUrl, 'tools'] as const,
    }),
    [baseUrl],
  )
  const queryClient = useQueryClient()

  const noMac = (): Promise<never> => Promise.reject(new Error('no Mac to ask'))
  const macLibrary = useQuery({
    queryKey: keys.library,
    queryFn: () => (mac ? mac.library() : noMac()),
    enabled: mac !== null,
    staleTime: 30_000,
  })
  const macQueue = useQuery({
    queryKey: keys.queue,
    queryFn: () => (mac ? mac.importQueue() : noMac()),
    enabled: mac !== null,
    // The same rhythm as the screen's own queue: every second while busy, then not at all.
    refetchInterval: query => {
      const data = query.state.data
      if (!data) return false
      return data.active > 0 || data.queued > 0 ? 1_000 : false
    },
  })
  const macTools = useQuery({
    queryKey: keys.tools,
    queryFn: () => (mac ? mac.importTools() : noMac()),
    enabled: mac !== null,
    staleTime: 60_000,
    retry: false,
  })

  const ownLibrary = useLibrary()
  const ownQueue = useImportQueue(mac === null)
  const ownTools = useImportTools(mac === null)

  if (mac) {
    return {
      api: mac,
      library: macLibrary.data,
      tools: macTools.data,
      refetchTools: macTools.refetch,
      queue: macQueue.data,
      invalidateQueue: () => queryClient.invalidateQueries({ queryKey: keys.queue }),
      invalidateLibrary: () => queryClient.invalidateQueries({ queryKey: keys.library }),
    }
  }
  return {
    api: clientApi(),
    library: ownLibrary.data,
    tools: ownTools.data,
    refetchTools: ownTools.refetch,
    queue: ownQueue.data,
    invalidateQueue: () => queryClient.invalidateQueries({ queryKey: queryKeys.importQueue }),
    invalidateLibrary: () => queryClient.invalidateQueries({ queryKey: queryKeys.library }),
  }
}
