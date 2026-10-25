import { useCallback } from 'react'
import { yoursOf } from '@selfmp3/client'
import type { RoomSong } from '@selfmp3/shared'
import { KEPT_COVER_SIZE } from '../../offline/covers'
import { useArt } from '../../offline/useArt'
import { useLibraryIndex, useSongsById } from '../../ui/songsById'

/**
 * A link's song's cover, drawn from your own copy when you have the song: a
 * link you sent is all your own songs. That copy is on this device already,
 * where the link's address is a read of the sender's bucket every time it is
 * drawn — refused once the bucket's allowance for the day is used up, which
 * left every row of Links you shared a letter. Otherwise the address the link
 * lends it at. Null for none, and undefined for one on its way, as `useArt`
 * says.
 */
export function useOwnCover(
  drawnAt: number = KEPT_COVER_SIZE,
): (song: RoomSong | null, lent: string | null) => string | null | undefined {
  const index = useLibraryIndex()
  const byId = useSongsById()
  const artFor = useArt(drawnAt)
  return useCallback(
    (song, lent) => {
      const id = song ? yoursOf(song, index) : null
      const own = id !== null ? byId.get(id) : undefined
      return own?.hasArt ? artFor(own) : lent
    },
    [index, byId, artFor],
  )
}
