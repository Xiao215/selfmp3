import type { RefObject } from 'react'
import type { View } from 'react-native'
import { formatBytes } from '@selfmp3/shared'
import { bytesToDownload, isDownloaded, useManifest } from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { openShareSheet } from '../../features/share/shareSheet.store'
import { openRoomSheet } from '../../features/room/roomSheets.store'
import { useRoom } from '../../features/room/room.store'
import { addSongsToRoom } from '../../features/room/addSongsToRoom'
import { roomTitle, youMay } from '../../features/room/room.model'
import { devicePlace } from '../../features/settings/settings.model'
import { useFlyToUpNext } from '../../features/queue/useFlyToUpNext'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { deviceKind } from '../../ports/device'
import type { Selection } from '../../selection/useSelection'
import { SONG_ACTION_LABELS } from '../songActions.model'
import { CheckSquare, CloudDownload, CloudRemove, Next, People, QueueAdd, ShareOut } from './Icons'
import type { MenuItem } from './MoreMenu'

/**
 * What a list page's ⋯ offers for all its songs — a tag's, an artist's, a
 * playlist's, an answer's: Select songs, Play next, Add to Up next with its
 * covers flying from the head, keeping them on this device or letting them
 * go, sending them as a share link (docs/features/share-links.md) when
 * the page names them, and Listen together — a room that starts with all of
 * them (A2, Xiao 2026-10-14), or, in a room, adding them to it. The page adds
 * what is its own after these (`MoreMenu`).
 *
 * The answer page's Add to Up next had played the songs next instead
 * (T-383), and only a playlist could be downloaded from its page.
 */
export function useListActions(
  songIds: readonly number[],
  {
    heroRef,
    selection,
    shareAs,
    togetherAs,
  }: {
    /** The head's picture, which the covers fly from. */
    heroRef?: RefObject<View | null>
    /** The page's selection, which Select songs starts. */
    selection?: Selection
    /** The tag's or playlist's name, for Share link; left out, the page offers none. */
    shareAs?: string
    /** The list's name, for a room started from it; left out, the page offers none. */
    togetherAs?: string
  } = {},
): readonly MenuItem[] {
  const player = usePlayerCommands()
  const fly = useFlyToUpNext()
  const manifest = useManifest()
  const { state: downloads, installed, requestDownload, removing } = useDownloads()
  // Taking them off this device can be undone, as one song's can.
  const removeDownloads = useDownloadRemoval()
  const { fromCloud, needsStorage } = useConnection()
  const { state: room } = useRoom()

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
    // A link lends from your bucket, so there has to be one.
    ...(shareAs !== undefined && fromCloud && !needsStorage
      ? [
          {
            key: 'share',
            label: SONG_ACTION_LABELS.share,
            icon: <ShareOut tone="textSecondary" />,
            disabled: nothing,
            onPress: () => openShareSheet({ songIds, name: shareAs, kind: 'list' }),
          },
        ]
      : []),
    // A room lends from your bucket too. In one, the songs go into it instead.
    ...(togetherAs !== undefined && fromCloud && !needsStorage
      ? room
        ? youMay(room, 'add')
          ? [
              {
                key: 'together',
                label: `Add to ${roomTitle(room)}`,
                icon: <People tone="textSecondary" />,
                disabled: nothing,
                onPress: () => void addSongsToRoom(songIds, roomTitle(room)),
              },
            ]
          : []
        : [
            {
              key: 'together',
              label: 'Listen together',
              icon: <People tone="textSecondary" />,
              disabled: nothing,
              testID: 'list-together',
              onPress: () => openRoomSheet({ kind: 'songs', name: togetherAs, songIds }),
            },
          ]
      : []),
  ]
}
