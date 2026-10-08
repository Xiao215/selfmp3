import { useCallback } from 'react'
import type { PopoverAnchor } from '../../ui/rightClick'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { flyToUpNext } from '../../ui/coverFlight'
import { useSongsById } from '../../ui/songsById'
import { useQueueSheetOpen } from './queueSheet.store'

/**
 * Send the first covers of what was just played or queued to the Up next
 * button (`ui/coverFlight.ts`), from the thing that was pressed. Nothing
 * flies while Up next is open: there its rows arriving say it.
 */
export function useFlyToUpNext(): (from: PopoverAnchor | null, songIds: readonly number[]) => void {
  const open = useQueueSheetOpen()
  const artFor = useArt(ROW_COVER_SIZE)
  const byId = useSongsById()
  return useCallback(
    (from, songIds) => {
      // Three covers at most.
      const uris = songIds.slice(0, 3).flatMap(id => {
        const song = byId.get(id)
        return song ? [artFor(song)] : []
      })
      flyToUpNext(from, uris, open)
    },
    [open, artFor, byId],
  )
}
