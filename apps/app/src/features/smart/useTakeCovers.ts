import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, type Api } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { library as cloudLibrary } from '../../replica'
import { useSmartServer } from './useSmartServer'

interface TakeCovers {
  /**
   * Takes each cover in. Answers the songs whose cover was taken, by this
   * device's id, and how many could not be: a picture the catalogue no longer
   * serves, or a song the server has not fetched yet.
   */
  readonly take: (
    covers: readonly { songId: number; artworkUrl: string }[],
  ) => Promise<{ taken: number[]; missed: number }>
  /**
   * Takes those covers off again, the Undo: a fill only fills a cover that is
   * missing, so the song is left with none, as it was. Answers how many could
   * not be taken off.
   */
  readonly takeBack: (songIds: readonly number[]) => Promise<number>
}

/**
 * Covers Tidy up filled in, taken in by the server (docs/features/ai.md, A4):
 * a cover is no edit of a song's names, it is a picture the server downloads
 * and puts in the bucket, as Fix song info's does
 * (`features/metadata/metadataSource.ts`), and its Undo is the server taking
 * it off again (`DELETE /api/songs/:id/cover`). A cloud library sees either
 * with the server's next sync, so its copy is marked stale for the look after.
 */
export function useTakeCovers(): TakeCovers {
  const { fromCloud } = useConnection()
  const server = useSmartServer()
  const client = useQueryClient()

  const changed = (): void => {
    if (fromCloud) cloudLibrary.markCloudLibraryStale()
    else void client.invalidateQueries({ queryKey: queryKeys.library })
  }

  /** Each song on the server, asked one at a time; the ones that went through. */
  const each = async (
    songIds: readonly number[],
    ask: (api: Api, serverId: number, songId: number) => Promise<boolean>,
  ): Promise<number[]> => {
    const done: number[] = []
    for (const songId of songIds) {
      const id = server.onServer(songId)
      if (!server.api || id === undefined) continue
      try {
        if (await ask(server.api, id, songId)) done.push(songId)
      } catch {
        // Counted as not done.
      }
    }
    if (done.length > 0) changed()
    return done
  }

  return {
    take: async covers => {
      const urls = new Map(covers.map(cover => [cover.songId, cover.artworkUrl]))
      const taken = await each([...urls.keys()], async (api, id, songId) => {
        const artworkUrl = urls.get(songId)
        if (artworkUrl === undefined) return false
        return (await api.applyMetadata(id, { artworkUrl })).artworkSaved
      })
      return { taken, missed: covers.length - taken.length }
    },
    takeBack: async songIds => {
      const done = await each(songIds, async (api, id) => {
        await api.removeCover(id)
        return true
      })
      return songIds.length - done.length
    },
  }
}
