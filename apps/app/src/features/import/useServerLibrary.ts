import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Library, Tag } from '@selfmp3/shared'
import { STALE, type Api } from '@selfmp3/client'
import { noServer, viaKey } from '../../connection/via'

interface ServerLibrary {
  /** The server's own library, once read: its tags are numbered its own way. */
  readonly library: Library | undefined
  /** Make a tag on the server, and read its library again so the tag is there. */
  readonly createTag: (name: string) => Promise<Tag>
}

/**
 * A server's library, read from it directly, and a tag made there: what Import
 * offers when it is pointed at the server (`useImportSource`). One query
 * under one key (`viaKey(baseUrl, 'library')`).
 */
export function useServerLibrary(api: Api | null, baseUrl: string | undefined): ServerLibrary {
  const queryClient = useQueryClient()
  const key = useMemo(() => viaKey(baseUrl, 'library'), [baseUrl])
  const { data: library } = useQuery({
    queryKey: key,
    queryFn: () => (api ? api.library() : noServer()),
    enabled: api !== null,
    staleTime: STALE.halfMinute,
  })
  // Steady between renders: the picker rebuilds its list around this.
  const createTag = useCallback(
    async (name: string): Promise<Tag> => {
      if (!api) return noServer()
      const tag = await api.createTag({ name })
      await queryClient.invalidateQueries({ queryKey: key })
      return tag
    },
    [api, queryClient, key],
  )
  return { library, createTag }
}
