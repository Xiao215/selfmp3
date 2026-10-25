import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type Library } from '@selfmp3/shared'
import { queryKeys } from '@selfmp3/client'
import { showPendingToast } from '../ui/toast'
import { useDownloads } from './DownloadsProvider'
import { devicePlace } from '../features/settings/settings.model'
import { deviceKind } from '../ports/device'

/**
 * Downloads off this device at once, with an Undo for five seconds
 * (docs/features/offline-sync.md). By hand, so the removal is remembered and the
 * next automatic pass does not fetch them straight back.
 *
 * The files are kept until the Undo has gone (`showPendingToast`): the songs
 * are drawn as not here at once (`holdLeaving`), and an Undo just draws them
 * here again. Deleting them first made an Undo download every one anew.
 */
/** The removals sent so far, so the next waits for them. */
let removals: Promise<unknown> = Promise.resolve()

export function useDownloadRemoval(): (songIds: readonly number[]) => void {
  const { removeByHand, holdLeaving } = useDownloads()
  // The library is read when a removal is made, not watched: this is in every
  // song's menu, and `useLibrary` in each of them kept the whole list busy.
  const client = useQueryClient()
  return useCallback(
    (songIds: readonly number[]) => {
      if (songIds.length === 0) return
      const place = devicePlace(deviceKind())
      const gone = new Set(songIds)
      const library = client.getQueryData<Library>(queryKeys.library)
      const songs = library?.songs.filter(song => gone.has(song.id)) ?? []
      const [only] = songs
      holdLeaving(songIds, true)
      showPendingToast(
        {
          over: `Removed from this ${place}`,
          say: songIds.length === 1 && only ? only.title : plural(songIds.length, 'song', 'songs'),
        },
        () => {
          // One after another: removals folded together are sent at the same
          // moment, and two passes over the index at once lose one's writes.
          const sent = removals.then(() => removeByHand(songIds))
          removals = sent.catch(() => undefined)
          return sent.finally(() => holdLeaving(songIds, false))
        },
        {
          songs,
          group: 'downloads-removed',
          failed: `Couldn’t remove them from this ${place}`,
          undone: () => holdLeaving(songIds, false),
        },
      )
    },
    [removeByHand, holdLeaving, client],
  )
}
