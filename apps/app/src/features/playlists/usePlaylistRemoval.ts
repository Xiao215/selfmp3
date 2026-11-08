import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type Library, type PlaylistSongs } from '@selfmp3/shared'
import { queryKeys, useRemoveManyFromPlaylist } from '@selfmp3/client'
import { sendPendingIn, showPendingToast } from '../../ui/toast'

/**
 * The kind of message a playlist's removals fold into, which is also how what
 * waits on its Undo is found to be sent before the playlist is added to
 * (`beforeAddingTo`).
 */
function removedFrom(playlistId: number): string {
  return `playlist-removed-${playlistId}`
}

/**
 * Sends a playlist's removals that wait on their Undo before songs are added
 * to it (`beforeAddingTo`), so the songs added go in after them and stay. A
 * playlist the removals emptied went with them, kept aside, and the songs
 * added bring it back as it was (`playlistEmptied`, docs/SYNC.md).
 */
export function beforeRefilling(playlistId: number): Promise<void> {
  return sendPendingIn(removedFrom(playlistId))
}

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
 *
 * Taking out the last of its songs takes the playlist too, and the message
 * says so: a playlist exists once it has a song (docs/UI-MIGRATION.md, Phase
 * 5). The removal itself does that, on the server or in this device's cloud
 * library (`playlistEmptied`), and only when it is still empty as the removal
 * lands: deleted outright from here, a song another device had just put in it
 * was lost everywhere (bug bash R7H-1). Nothing is sent before the Undo's time
 * is up, so Undo puts back the songs with the playlist just as it was.
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
      const songCount = library?.playlists.find(each => each.id === playlist.id)?.songCount
      // Its last songs: what is left on its page, or, with no page drawn, its count.
      const emptied = before
        ? before.songIds.every(id => gone.has(id))
        : songCount !== undefined && songCount <= gone.size
      const [only] = songs
      showPendingToast(
        {
          over: `Removed from ${playlist.name}`,
          say: songs.length === 1 && only ? only.title : plural(songs.length, 'song', 'songs'),
          ...(emptied ? { under: 'The playlist goes with its last song' } : {}),
        },
        async () => {
          try {
            await removeMany({ playlistId: playlist.id, songIds })
          } catch {
            // The removal that failed has said so (its `meta.failure`); asking
            // for the playlist again brings its rows back.
            void client.invalidateQueries({ queryKey: key })
          }
        },
        {
          songs: library?.songs.filter(song => gone.has(song.id)) ?? [],
          group: removedFrom(playlist.id),
          undone: () => {
            if (before) client.setQueryData(key, before)
          },
        },
      )
    },
    [client, removeMany],
  )
}
