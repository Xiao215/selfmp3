import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type Library, type PlaylistSongs } from '@selfmp3/shared'
import { queryKeys, useDeletePlaylist, useRemoveManyFromPlaylist } from '@selfmp3/client'
import { sendPendingIn, showPendingToast } from '../../ui/toast'

/**
 * The kind of message a playlist's removals fold into, which is also how what
 * waits on its Undo is found to be sent before the playlist is added to
 * (`beforeAddingTo`).
 */
function removedFrom(playlistId: number): string {
  return `playlist-removed-${playlistId}`
}

/** Playlists being added to while a removal from them waits: kept, though it emptied them. */
const refilling = new Set<number>()

/**
 * Sends a playlist's removals that wait on their Undo before songs are added
 * to it (`beforeAddingTo`), as removals and nothing more: a playlist emptied
 * and then given songs again inside the Undo's time is being filled, and is
 * not deleted with its last song.
 */
export function beforeRefilling(playlistId: number): Promise<void> {
  refilling.add(playlistId)
  // The removals' sends begin in this same turn, so each reads the mark.
  const sent = sendPendingIn(removedFrom(playlistId))
  refilling.delete(playlistId)
  return sent
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
 * Taking out the last of its songs deletes the playlist too, once the Undo's
 * time is up, and the message says so: a playlist exists once it has a song
 * (docs/UI-MIGRATION.md, Phase 5). Emptied and left, it was listed nowhere and
 * stayed for good (bug bash R2-m12). Nothing is sent before then, so Undo
 * puts back the songs with the playlist just as it was: name, cover, place.
 * The songs go first, as their own edit, so a tab closing in between keeps
 * them out (`keepEditsAsLeaving`) and leaves at worst an empty playlist in
 * the sidebar (`emptyPlaylists`).
 */
export function usePlaylistRemoval(): (
  playlist: { readonly id: number; readonly name: string },
  songs: readonly { readonly id: number; readonly title: string }[],
) => void {
  const client = useQueryClient()
  const { mutateAsync: removeMany } = useRemoveManyFromPlaylist()
  const { mutateAsync: deletePlaylist } = useDeletePlaylist()

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
          const refilled = refilling.has(playlist.id)
          try {
            await removeMany({ playlistId: playlist.id, songIds })
          } catch {
            // The removal that failed has said so (its `meta.failure`); asking
            // for the playlist again brings its rows back.
            void client.invalidateQueries({ queryKey: key })
            return
          }
          // Only once its songs are out, and not while songs are going back in.
          // Removed again within the time, each removal is sent in turn and
          // only the one that emptied it deletes it.
          if (emptied && !refilled) await deletePlaylist(playlist.id).catch(() => undefined)
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
    [client, removeMany, deletePlaylist],
  )
}
