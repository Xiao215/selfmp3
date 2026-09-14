import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportQueue, Library, ToolStatus } from '@selfmp3/shared'
import { clientApi, queryKeys } from '@selfmp3/client'
import { apiFor, type ServerConnection } from '../../api/client'
import { useImportQueue, useImportTools, useLibrary } from '../../api/queries'

/**
 * Whom the Import screen talks to: whatever answers this device, or — from a
 * cloud library, with the server within reach — that server directly.
 *
 * The screen's own hooks ask whatever answers this device, which for a cloud
 * library is the bucket, and the bucket cannot read a link. A server reached
 * directly numbers its tags and playlists its own way, so its library is read
 * from it too, rather than from this device's copy, and what is queued names
 * the server's ids.
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
  const server = useMemo(
    () => (baseUrl === undefined ? null : apiFor({ baseUrl, token })),
    [baseUrl, token],
  )
  const keys = useMemo(
    () => ({
      library: ['via-server', baseUrl, 'library'] as const,
      queue: ['via-server', baseUrl, 'queue'] as const,
      tools: ['via-server', baseUrl, 'tools'] as const,
    }),
    [baseUrl],
  )
  const queryClient = useQueryClient()

  const noServer = (): Promise<never> => Promise.reject(new Error('no server to ask'))
  const serverLibrary = useQuery({
    queryKey: keys.library,
    queryFn: () => (server ? server.library() : noServer()),
    enabled: server !== null,
    staleTime: 30_000,
  })
  const serverQueue = useQuery({
    queryKey: keys.queue,
    queryFn: () => (server ? server.importQueue() : noServer()),
    enabled: server !== null,
    // The same rhythm as the screen's own queue: every second while busy, then not at all.
    refetchInterval: query => {
      const data = query.state.data
      if (!data) return false
      return data.active > 0 || data.queued > 0 ? 1_000 : false
    },
  })
  const serverTools = useQuery({
    queryKey: keys.tools,
    queryFn: () => (server ? server.importTools() : noServer()),
    enabled: server !== null,
    staleTime: 60_000,
    retry: false,
  })

  const ownLibrary = useLibrary()
  const ownQueue = useImportQueue(server === null)
  const ownTools = useImportTools(server === null)

  if (server) {
    return {
      api: server,
      library: serverLibrary.data,
      tools: serverTools.data,
      refetchTools: serverTools.refetch,
      queue: serverQueue.data,
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
