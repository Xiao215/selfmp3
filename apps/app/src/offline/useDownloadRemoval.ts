import { useCallback } from 'react'
import { plural } from '@selfmp3/shared'
import { failureText } from '@selfmp3/client'
import { showToast, showUndoToast } from '../ui/toast'
import { useDownloads } from './DownloadsProvider'
import { devicePlace } from '../features/settings/settings.model'
import { deviceKind } from '../ports/device'

/**
 * Downloads off this device at once, with an Undo for five seconds
 * (docs/features/offline-sync.md). By hand, so the removal is remembered and the
 * next automatic pass does not fetch them straight back; the Undo downloads
 * them again by hand, which forgets it. The files themselves are gone the
 * moment they are removed, so Undo fetches them anew rather than keeping
 * them about for five seconds in case.
 */
export function useDownloadRemoval(): (songIds: readonly number[]) => void {
  const { removeByHand, downloadByHand } = useDownloads()
  return useCallback(
    (songIds: readonly number[]) => {
      if (songIds.length === 0) return
      removeByHand(songIds)
        .then(() =>
          showUndoToast(
            `Removed ${plural(songIds.length, 'song', 'songs')} from this ${devicePlace(deviceKind())}`,
            () => downloadByHand(songIds),
          ),
        )
        .catch((caught: unknown) =>
          showToast(
            failureText(`Couldn’t remove them from this ${devicePlace(deviceKind())}`, caught),
            'error',
          ),
        )
    },
    [removeByHand, downloadByHand],
  )
}
