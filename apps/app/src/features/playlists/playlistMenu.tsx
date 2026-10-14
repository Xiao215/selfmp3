import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Playlist } from '@selfmp3/shared'
import { failureText, useCreatePlaylist, useDeletePlaylist, useLibrary } from '@selfmp3/client'
import type { Selection } from '../../selection/useSelection'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Copy, Pencil, Trash } from '../../ui/components/Icons'
import type { MenuItem } from '../../ui/components/MoreMenu'
import { useListActions } from '../../ui/components/useListActions'
import { showToast } from '../../ui/toast'
import { copyName, isLive, newPlaylist } from './playlists.model'

/**
 * What a playlist's menu offers, the same from its page's ⋯ and from its tile
 * on Playlists (right-click, or a hold): what every list offers for its songs
 * (`useListActions`), then what a playlist adds — a copy, renaming, a
 * description, a duplicate, deleting.
 *
 * `songIds` is undefined until the playlist's songs are known: what needs
 * them waits, so a copy is never made of a list not loaded yet. Renaming,
 * describing and deleting are the caller's, since the page does them in place
 * and the tile goes to the page for the first two.
 */
export function usePlaylistMenu(
  playlist: Playlist | null,
  songIds: readonly number[] | undefined,
  {
    heroRef,
    selection,
    onRename,
    onDescribe,
    onDelete,
  }: {
    heroRef?: RefObject<View | null>
    selection?: Selection
    onRename: () => void
    onDescribe: () => void
    onDelete: () => void
  },
): readonly MenuItem[] {
  const router = useRouter()
  const library = useLibrary()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const name = playlist?.name ?? 'Playlist'
  const live = playlist !== null && isLive(playlist)
  const ids = songIds ?? []
  const listActions = useListActions(ids, { heroRef, selection, shareAs: name, togetherAs: name })

  /** A copy: a live playlist's rules, or a playlist's songs as they are now. */
  const makeCopy = async (kind: 'manual' | 'live'): Promise<void> => {
    if (!playlist) return
    const input = newPlaylist(
      kind,
      copyName(
        playlist.name,
        (library.data?.playlists ?? []).map(entry => entry.name),
      ),
      { description: playlist.description, rules: playlist.rules ?? undefined },
    )
    if (!input) return
    try {
      const created = await createPlaylist({ input, songIds: kind === 'manual' ? ids : [] })
      showToast(`Made “${created.name}”`, 'good')
      router.push({ pathname: '/playlists/[id]', params: { id: String(created.id) } })
    } catch (caught) {
      showToast(failureText(`Couldn’t copy “${playlist.name}”`, caught), 'error')
    }
  }

  return [
    ...listActions,
    ...(live
      ? [
          {
            key: 'save-copy',
            label: 'Save a copy as playlist',
            icon: <Copy tone="textSecondary" />,
            disabled: ids.length === 0,
            apart: true,
            onPress: () => void makeCopy('manual'),
          },
        ]
      : []),
    {
      key: 'rename',
      label: 'Rename',
      icon: <Pencil tone="textSecondary" />,
      apart: !live,
      onPress: onRename,
    },
    {
      key: 'describe',
      label: playlist?.description ? 'Edit description' : 'Add a description',
      icon: <Pencil tone="textSecondary" />,
      onPress: onDescribe,
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: <Copy tone="textSecondary" />,
      // A live playlist's copy is its rules; anything else's is its songs.
      disabled: !live && songIds === undefined,
      onPress: () => void makeCopy(live ? 'live' : 'manual'),
    },
    {
      key: 'delete',
      label: 'Delete playlist…',
      icon: <Trash tone="danger" />,
      danger: true,
      apart: true,
      onPress: onDelete,
    },
  ]
}

/** Asking before a playlist goes; its songs stay. `onDeleted` after it is asked to go. */
export function DeletePlaylistDialog({
  playlist,
  onClose,
  onDeleted,
}: {
  /** The playlist asked about; null when nothing is. */
  playlist: Playlist | null
  onClose: () => void
  onDeleted?: () => void
}): ReactNode {
  const deletePlaylist = useDeletePlaylist()
  // The name stays through the dialog's way out, after the playlist is let go.
  const [named, setNamed] = useState(playlist)
  if (playlist !== null && playlist !== named) setNamed(playlist)
  return (
    <ConfirmDialog
      open={playlist !== null}
      title={`Delete the playlist “${named?.name ?? 'Playlist'}”?`}
      body="Your songs are kept."
      confirmLabel="Delete playlist"
      danger
      onCancel={onClose}
      onConfirm={() => {
        onClose()
        if (!playlist) return
        deletePlaylist.mutate(playlist.id)
        onDeleted?.()
      }}
    />
  )
}
