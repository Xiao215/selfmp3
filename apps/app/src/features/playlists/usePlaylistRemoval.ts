import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { plural, type PlaylistSongs } from '@selfmp3/shared'
import {
  clientApi,
  queryKeys,
  useAddToPlaylist,
  useRemoveManyFromPlaylist,
  useReorderPlaylist,
} from '@selfmp3/client'
import { showUndoToast } from '../../ui/toast'
import { restoredOrder } from './playlists.model'

/**
 * Songs out of a playlist at once, with an Undo for five seconds that puts
 * them back where they were (docs/features/multi-select.md). The song's menu
 * and the selection bar both remove this way.
 *
 * The order is the one on screen when the songs went: a playlist's page has
 * its members in the cache. The Undo adds the songs back, which puts them at
 * the end, and then sends the order as it was (`restoredOrder`), which is the
 * one edit the server, the sync log and the bucket all speak.
 */
export function usePlaylistRemoval(): (
  playlist: { readonly id: number; readonly name: string },
  songs: readonly { readonly id: number; readonly title: string }[],
) => void {
  const client = useQueryClient()
  const { mutateAsync: removeMany } = useRemoveManyFromPlaylist()
  const { mutateAsync: add } = useAddToPlaylist()
  const { mutateAsync: reorder } = useReorderPlaylist()

  return useCallback(
    (playlist, songs) => {
      const songIds = songs.map(song => song.id)
      if (songIds.length === 0) return
      const before =
        client.getQueryData<PlaylistSongs>(queryKeys.playlistSongs(playlist.id))?.songIds ?? null
      const [only] = songs
      const text =
        songs.length === 1 && only
          ? `Removed “${only.title}” from ${playlist.name}`
          : `Removed ${plural(songs.length, 'song', 'songs')} from ${playlist.name}`
      removeMany({ playlistId: playlist.id, songIds }).then(
        () =>
          showUndoToast(text, () => {
            void (async () => {
              await add({ playlistId: playlist.id, songIds })
              // Without the order from before there is no place to put them
              // back in, and the end is where adding leaves them.
              if (!before) return
              const now = await clientApi().playlistSongs(playlist.id)
              await reorder({
                playlistId: playlist.id,
                songIds: restoredOrder(before, now.songIds),
              })
            })().catch(() => {
              // Each edit that failed has said so (its `meta.failure`).
            })
          }),
        // The removal that failed has said so.
        () => undefined,
      )
    },
    [client, removeMany, add, reorder],
  )
}
