import { useCallback } from 'react'
import type { View } from 'react-native'
import { useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { flyToUpNext } from '../../ui/coverFlight'
import { useQueueSheetOpen } from './queueSheet.store'

/**
 * Send the first covers of what was just played or queued to the Up next
 * button (`ui/coverFlight.ts`), from the thing that was pressed. Nothing
 * flies while Up next is open: there its rows arriving say it.
 */
export function useFlyToUpNext(): (from: View | null, songIds: readonly number[]) => void {
  const open = useQueueSheetOpen()
  const artFor = useArt(ROW_COVER_SIZE)
  const { data: library } = useLibrary()
  return useCallback(
    (from, songIds) => {
      const byId = new Map((library?.songs ?? []).map(song => [song.id, song]))
      const uris = songIds.slice(0, 3).flatMap(id => {
        const song = byId.get(id)
        return song ? [artFor(song)] : []
      })
      flyToUpNext(from, uris, open)
    },
    [open, artFor, library],
  )
}
