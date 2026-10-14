import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { libraryIndex, useLibrary, yoursOf } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { keepLent, pictureFor, picturesVersion, subscribePictures } from '../../offline/covers'
import { useArt } from '../../offline/useArt'
import { lentCoverKey } from './pastRooms.store'
import type { PastRoom } from './room.model'

/**
 * Each song of a room that ended, as the picture to draw for it, in the
 * room's order: what the room's page lists and its Home tile is made of.
 *
 * The room lent its covers only while it was open, so a song you have draws
 * your own copy's, a friend's the copy this device kept as it played
 * (RoomProvider), and a link the picture its page showed. Null for none, and
 * undefined for one on its way, as `useArt` says.
 */
export function usePastRoomCovers(
  past: PastRoom | undefined,
): readonly (string | null | undefined)[] {
  const { data: library } = useLibrary()
  const index = useMemo(() => libraryIndex(library?.songs ?? []), [library?.songs])
  const byId = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library?.songs],
  )
  const artFor = useArt(ROW_COVER_SIZE)
  // Read so that a friend's kept cover, found on the disk, draws again.
  useSyncExternalStore(subscribePictures, picturesVersion)
  useEffect(() => {
    for (const key of past?.songs.flatMap(lentCoverKey) ?? []) {
      if (!pictureFor(key)) void keepLent(key)
    }
  }, [past])

  return (past?.songs ?? []).map(entry => {
    const id = yoursOf(entry.song, index)
    const own = id !== null ? byId.get(id) : undefined
    if (own) return artFor(own)
    const lent = entry.song.cover ? pictureFor(entry.song.cover.key) : undefined
    return lent ?? entry.song.artwork
  })
}
