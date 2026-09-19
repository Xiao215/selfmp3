import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'expo-router'
import type { Song, Tag } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { usePlayer, type PlayerApi } from '../../player/PlayerProvider'
import { showToast } from '../../ui/toast'
import { noteTagUsed } from '../library/recentTags.store'
import { tagLink } from '../tag/placeLinks'
import { closeQueueSheet } from './queueSheet.store'
import { queueRows, removalOf, restoreMoves, UNDO_MS } from './queue.model'

/**
 * What Up next does to the queue, shared by the phone's sheet and the
 * computer's rail so a swipe, a drag out, Delete and the menu all remove the
 * same way, with the same Undo.
 */
export function useQueueEdits(): {
  player: PlayerApi
  rows: ReturnType<typeof queueRows>
  /** Take one song out, with an Undo for five seconds. */
  remove: (index: number) => void
  tagsOf: (song: Song) => Tag[]
  openTag: (tagId: number) => void
} {
  const player = usePlayer()
  const router = useRouter()
  const { data: library } = useLibrary()

  /*
   * The player as it is now, for an Undo pressed seconds after the removal.
   * The toast keeps the closure it was given; the queue it has to put the song
   * back into is the one at the moment of the press, and the sheet and the rail
   * stay mounted (drawing nothing while shut) so this is always current.
   */
  const latest = useRef(player)
  useEffect(() => {
    latest.current = player
  })

  const byId = useMemo(() => new Map(player.songs.map(song => [song.id, song])), [player.songs])
  const rows = useMemo(() => queueRows(player.queue, byId), [player.queue, byId])

  const remove = useCallback((index: number) => {
    const now = latest.current
    const removal = removalOf(now.queue.items, index)
    if (!removal) return
    const song = now.songs.find(entry => entry.id === removal.id)
    now.removeFromQueue(index)
    showToast(song ? `Removed ${song.title}` : 'Removed from Up next', 'info', {
      autoDismissMs: UNDO_MS,
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            const live = latest.current
            const moves = restoreMoves(live.queue, removal)
            if (!moves) return
            // Both go through the player's own queue edits, which read and write
            // its queue synchronously, so the move sees the song just put back.
            live.playNext([removal.id])
            if (moves.from !== moves.to) live.reorderQueue(moves.from, moves.to)
          },
        },
      ],
    })
  }, [])

  // Up next is one of the lists that shows a song's tags (`S3`); a chip opens the tag.
  const tagsById = useMemo(
    () => new Map((library?.tags ?? []).map(tag => [tag.id, tag])),
    [library],
  )
  const tagsOf = useCallback(
    (song: Song) =>
      song.tagIds.flatMap(id => {
        const tag = tagsById.get(id)
        return tag ? [tag] : []
      }),
    [tagsById],
  )
  const openTag = useCallback(
    (tagId: number) => {
      const tag = tagsById.get(tagId)
      if (!tag) return
      noteTagUsed(tag.id)
      closeQueueSheet()
      router.navigate(tagLink(tag.name))
    },
    [tagsById, router],
  )

  return { player, rows, remove, tagsOf, openTag }
}
