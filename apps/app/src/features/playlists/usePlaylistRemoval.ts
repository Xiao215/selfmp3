import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type Library, type PlaylistSongs } from '@selfmp3/shared'
import { queryKeys, useRemoveManyFromPlaylist } from '@selfmp3/client'
import { showPendingToast } from '../../ui/toast'

/**
 * Songs out of a playlist at once, with an Undo for five seconds
 * (docs/features/multi-select.md). The song's menu and the selection bar both
 * remove this way.
 *
 * Nothing is sent until the Undo has gone (`showPendingToast`): the rows leave
 * the playlist's page at once, from its cache, and an Undo puts them back
 * there without the server having heard of it — rather than removing them and
 * then adding them back and sending the old order, three edits every device
 * would replay for a change of mind. Removed again within the five seconds,
 * the songs fold into the same message.
 */
export function usePlaylistRemoval(): (
  playlist: { readonly id: number; readonly name: string },
  songs: readonly { readonly id: number; readonly title: string }[],
) => void {
  const client = useQueryClient()
  const { mutateAsync: removeMany } = useRemoveManyFromPlaylist()

  return useCallback(
    (playlist, songs) => {
      const songIds = songs.map(song => song.id)
      if (songIds.length === 0) return
      const key = queryKeys.playlistSongs(playlist.id)
      const before = client.getQueryData<PlaylistSongs>(key)
      const gone = new Set(songIds)
      if (before) {
        client.setQueryData<PlaylistSongs>(key, {
          ...before,
          songIds: before.songIds.filter(id => !gone.has(id)),
        })
      }
      const library = client.getQueryData<Library>(queryKeys.library)
      const [only] = songs
      showPendingToast(
        {
          over: `Removed from ${playlist.name}`,
          say: songs.length === 1 && only ? only.title : plural(songs.length, 'song', 'songs'),
        },
        () =>
          // The removal that failed has said so (its `meta.failure`); asking
          // for the playlist again brings its rows back.
          removeMany({ playlistId: playlist.id, songIds }).catch(
            () => void client.invalidateQueries({ queryKey: key }),
          ),
        {
          songs: library?.songs.filter(song => gone.has(song.id)) ?? [],
          group: `playlist-removed-${playlist.id}`,
          undone: () => {
            if (before) client.setQueryData(key, before)
          },
        },
      )
    },
    [client, removeMany],
  )
}
