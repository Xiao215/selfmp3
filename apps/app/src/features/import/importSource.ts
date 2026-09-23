import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportQueue, Library, Tag, ToolStatus } from '@selfmp3/shared'
import {
  clientApi,
  queryKeys,
  useCreateTag,
  useImportQueue,
  useImportTools,
  useLibrary,
  type ServerConnection,
} from '@selfmp3/client'
import { apiFor } from '../../api/client'

/**
 * Whom the Import screen talks to: whatever answers this device, or — from a
 * cloud library, with the server within reach — that server directly.
 *
 * The screen's own hooks ask whatever answers this device, which for a cloud
 * library is the bucket, and the bucket cannot read a link. A server reached
 * directly numbers its tags and playlists its own way, so its library is read
 * from it too, rather than from this device's copy, and what is queued names
 * the server's ids.
 *
 * Which is why a tag made while importing is made there too (`createTag`).
 * The picker used to make it on this device whatever the screen was pointed
 * at: the new tag never came back as a chip — the chips are the server's
 * tags, and the server had never heard of it — and the import carried a
 * number that meant another tag there, or nothing (Xiao, 2026-09-22).
 */
interface ImportSource {
  readonly api: ReturnType<typeof apiFor>
  readonly library: Library | undefined
  /** Make a tag in the library whose tags this screen offers, and show it there. */
  readonly createTag: (name: string) => Promise<Tag>
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
  const createHere = useCreateTag()
  // Steady between renders: the picker rebuilds its list around this.
  const createOnServer = useCallback(
    async (name: string): Promise<Tag> => {
      if (!server) return noServer()
      const tag = await server.createTag(name)
      await queryClient.invalidateQueries({ queryKey: keys.library })
      return tag
    },
    [server, queryClient, keys.library],
  )
  // `mutateAsync` is the same function between renders; the object around it is not.
  const createOnDevice = createHere.mutateAsync

  if (server) {
    return {
      api: server,
      library: serverLibrary.data,
      createTag: createOnServer,
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
    createTag: createOnDevice,
    tools: ownTools.data,
    refetchTools: ownTools.refetch,
    queue: ownQueue.data,
    invalidateQueue: () => queryClient.invalidateQueries({ queryKey: queryKeys.importQueue }),
    invalidateLibrary: () => queryClient.invalidateQueries({ queryKey: queryKeys.library }),
  }
}
