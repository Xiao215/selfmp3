import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Href } from 'expo-router'
import { plural, type QueueState } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { usePlayer, type PlayerApi } from '../../player/PlayerProvider'
import { dismissToast, showUndoToast } from '../../ui/toast'
import { useOpenTag } from '../tag/useOpenTag'
import { closeQueueSheet } from './queueSheet.store'
import { queueRows, removalOf, restoreMoves, stillRestorable } from './queue.model'
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
 *
 * `go` follows a link out of Up next — a tag's chip — when the router's own
 * push would land somewhere unseen: under the phone's Now Playing modal.
 */
export function useQueueEdits(
  shown: boolean,
  go?: (href: Href) => void,
): {
  player: PlayerApi
  rows: ReturnType<typeof queueRows>
  /** Take one song out, with an Undo for five seconds. */
  remove: (index: number) => void
  /** Every song but the one playing out, with an Undo for five seconds. */
  clearRest: () => void
  openTag: (tagId: number) => void
} {
  const player = usePlayer()
  const { data: library } = useLibrary()

  /*
   * The player as it is now, for an Undo pressed seconds after the removal.
   * The toast keeps the closure it was given; the queue it has to put the song
   * back into is the one at the moment of the press, and the sheet and the rail
   * stay mounted (drawing nothing while shut) so this is always current.
   */
  const latest = useRef(player)
  /*
   * The Clear the rest message up, and the queue it cleared. Its Undo puts the
   * songs back only while the same song plays (`stillRestorable`); once
   * another has started, Undo was still offered and did nothing at all, so the
   * message goes instead.
   */
  const cleared = useRef<{ id: number; before: QueueState } | null>(null)
  useEffect(() => {
    latest.current = player
    const up = cleared.current
    if (up && !stillRestorable(player.queue, up.before)) {
      cleared.current = null
      dismissToast(up.id)
    }
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
    // Swiped out one after another, they fold into one message whose Undo
    // puts all of them back, newest first.
    showUndoToast(
      { over: 'Removed from Up next', say: song?.title ?? 'A song' },
      () => {
        const live = latest.current
        const moves = restoreMoves(live.queue, removal)
        if (!moves) return
        // Both go through the player's own queue edits, which read and write
        // its queue synchronously, so the move sees the song just put back.
        // A song put back is not one added: Up next keeps the name it had.
        const source = live.source
        live.playNext([removal.id])
        live.setSource(source)
        if (moves.from !== moves.to) live.reorderQueue(moves.from, moves.to)
      },
      { songs: song ? [song] : [], group: 'up-next-removed' },
    )
  }, [])

  const clearRest = useCallback(() => {
    const now = latest.current
    const before = now.clearRest()
    const count = before.items.length - 1
    if (count <= 0) return
    // The covers of the songs that were next, the first of them in front.
    const next = before.items
      .slice(before.index + 1, before.index + 4)
      .reverse()
      .flatMap(id => now.songs.find(song => song.id === id) ?? [])
    // Put back through the player as it is at the press, as a single removal is.
    const id = showUndoToast(
      { over: 'Cleared from Up next', say: plural(count, 'song', 'songs') },
      () => {
        cleared.current = null
        latest.current.restoreRest(before)
      },
      { songs: next },
    )
    cleared.current = { id, before }
  }, [])

  // Up next is one of the lists that shows a song's tags (`S3`); a chip opens the tag.
  const tags = library?.tags
  const open = useOpenTag()
  const openTag = useCallback(
    (tagId: number) => {
      const tag = tags?.find(each => each.id === tagId)
      if (!tag) return
      closeQueueSheet()
      open(tag, { go })
    },
    [tags, open, go],
  )

  return { player, rows, remove, clearRest, openTag }
}
