import type { RefObject } from 'react'
import type { View } from 'react-native'
import { formatBytes } from '@selfmp3/shared'
import { bytesToDownload, isDownloaded, useManifest } from '@selfmp3/client'
import { devicePlace } from '../../features/settings/settings.model'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { deviceKind } from '../../ports/device'
import type { Selection } from '../../selection/useSelection'
import { SONG_ACTION_LABELS } from '../songActions.model'
import { CheckSquare, CloudDownload, CloudRemove, Next, QueueAdd } from './Icons'
import type { MenuItem } from './MoreMenu'

/**
 * What a list page's ⋯ offers for all its songs — a tag's, an artist's, a
 * playlist's, an answer's: Select songs, Play next, Add to Up next with its
 * covers flying from the head, and keeping them on this device or letting
 * them go. The page adds what is its own after these (`MoreMenu`).
 *
 * The answer page's Add to Up next had played the songs next instead
 * (T-383), and only a playlist could be downloaded from its page.
 */
export function useListActions(
  songIds: readonly number[],
  {
    heroRef,
    selection,
  }: {
    /** The head's picture, which the covers fly from. */
    heroRef?: RefObject<View | null>
    /** The page's selection, which Select songs starts. */
    selection?: Selection
  } = {},
): readonly MenuItem[] {
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const manifest = useManifest()
  const { state: downloads, installed, requestDownload, removing } = useDownloads()
  // Taking them off this device can be undone, as one song's can.
  const removeDownloads = useDownloadRemoval()

  const nothing = songIds.length === 0
  const allHere = !nothing && songIds.every(id => isDownloaded(downloads.index, id))
  const pendingBytes = manifest.data ? bytesToDownload(downloads.index, manifest.data, songIds) : 0

  return [
    ...(selection
      ? [
          {
            key: 'select',
            label: SONG_ACTION_LABELS.selectSongs,
            icon: <CheckSquare tone="textSecondary" />,
            disabled: nothing,
            onPress: () => selection.enter(),
          },
        ]
      : []),
    {
      key: 'play-next',
      label: SONG_ACTION_LABELS.playNext,
      icon: <Next tone="textSecondary" />,
      disabled: nothing,
      onPress: () => {
        fly(heroRef?.current ?? null, songIds)
        player.playNext(songIds)
      },
    },
    {
      key: 'up-next',
      label: SONG_ACTION_LABELS.addToUpNext,
      icon: <QueueAdd tone="textSecondary" />,
      disabled: nothing,
      onPress: () => {
        fly(heroRef?.current ?? null, songIds)
        player.addToQueue(songIds)
      },
    },
    // Only an installed app keeps songs. Once every song is here the same
    // place takes them back off.
    ...(!installed || nothing
      ? []
      : allHere
        ? [
            {
              key: 'remove-download',
              label: `Remove from this ${devicePlace(deviceKind())}`,
              icon: <CloudRemove tone="textSecondary" />,
              disabled: removing,
              onPress: () => removeDownloads(songIds),
            },
          ]
        : [
            {
              key: 'download',
              label: 'Download',
              icon: <CloudDownload tone="textSecondary" />,
              detail: pendingBytes > 0 ? formatBytes(pendingBytes) : undefined,
              // By hand, as a song's menu downloads.
              onPress: () => requestDownload(songIds),
            },
          ]),
  ]
}
