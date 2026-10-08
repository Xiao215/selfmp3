import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'expo-router'
import { plural, type Tag } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { usePlayer, type PlayerApi } from '../../player/PlayerProvider'
import { useSongTagLookup } from '../../ui/songTags'
import { showToast, showUndoToast, UNDO_MS } from '../../ui/toast'
import { noteTagUsed } from '../library/recentTags.store'
import { tagLink } from '../tag/placeLinks'
import { closeQueueSheet } from './queueSheet.store'
import { queueRows, removalOf, restoreMoves } from './queue.model'
import { songsById } from '../../ui/songsById'

/** No rows: what a shut Up next is handed, so it does not resolve the whole queue for nothing. */
const NO_ROWS: ReturnType<typeof queueRows> = { playing: null, next: [], played: [] }

/**
 * What Up next does to the queue, shared by the phone's sheet and the
 * computer's rail so a swipe, a drag out, Delete and the menu all remove the
 * same way, with the same Undo.
 *
 * `shown` is whether the sheet or the rail is up. Both stay mounted while shut,
 * for the Undo, and every play, pause and song change reaches them; only an
 * open one resolves the queue into rows, which for a library shuffled is
 * thousands of songs.
 */
export function useQueueEdits(shown: boolean): {
  player: PlayerApi
  rows: ReturnType<typeof queueRows>
  /** Take one song out, with an Undo for five seconds. */
  remove: (index: number) => void
  /** Every song but the one playing out, with an Undo for five seconds. */
  clearRest: () => void
  /** A song's tags, the same array for the same song (`songTagLookup`), so a row's memo holds. */
  tagsOf: (song: { readonly tagIds: readonly number[] }) => readonly Tag[]
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

  const rows = useMemo(
    () => (shown ? queueRows(player.queue, songsById(player.songs)) : NO_ROWS),
    [shown, player.queue, player.songs],
  )

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

  const clearRest = useCallback(() => {
    const before = latest.current.clearRest()
    const cleared = before.items.length - 1
    if (cleared <= 0) return
    // Put back through the player as it is at the press, as a single removal is.
    showUndoToast(`Cleared ${plural(cleared, 'song', 'songs')}`, () =>
      latest.current.restoreRest(before),
    )
  }, [])

  // Up next is one of the lists that shows a song's tags (`S3`); a chip opens the tag.
  const tagsOf = useSongTagLookup()
  const tags = library?.tags
  const openTag = useCallback(
    (tagId: number) => {
      const tag = tags?.find(each => each.id === tagId)
      if (!tag) return
      noteTagUsed(tag.id)
      closeQueueSheet()
      router.navigate(tagLink(tag.name))
    },
    [tags, router],
  )

  return { player, rows, remove, clearRest, tagsOf, openTag }
}
