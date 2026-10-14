import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { library as cloudLibrary } from '../../replica'
import { useSmartServer } from './useSmartServer'

/**
 * Covers Tidy up filled in, taken in by the server (docs/features/ai.md, A4):
 * a cover is no edit of a song's names, it is a picture the server downloads
 * and puts in the bucket, as Fix song info's does
 * (`features/metadata/metadataSource.ts`). A cloud library sees it with the
 * server's next sync, so its copy is marked stale for the look after.
 *
 * Answers how many could not be taken: a picture the catalogue no longer
 * serves, or a song the server has not fetched yet.
 */
export function useTakeCovers(): (
  covers: readonly { songId: number; artworkUrl: string }[],
) => Promise<number> {
  const { fromCloud } = useConnection()
  const server = useSmartServer()
  const client = useQueryClient()
  return async covers => {
    let missed = 0
    for (const { songId, artworkUrl } of covers) {
      const id = server.onServer(songId)
      if (!server.api || id === undefined) {
        missed++
        continue
      }
      try {
        const { artworkSaved } = await server.api.applyMetadata(id, { artworkUrl })
        if (!artworkSaved) missed++
      } catch {
        missed++
      }
    }
    if (missed < covers.length) {
      if (fromCloud) cloudLibrary.markCloudLibraryStale()
      else void client.invalidateQueries({ queryKey: queryKeys.library })
    }
    return missed
  }
}
