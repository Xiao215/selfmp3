import { useCallback, useEffect, useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../api/client'
import { useConnection } from '../server/ConnectionProvider'
import { coversNow, ensureCover, onCoversChanged } from './covers'

/**
 * Where a song's artwork comes from, for whichever screen is asking.
 *
 * A Mac serves it over HTTP with the token in the query string. The bucket
 * cannot: the image loader is handed a URL and given no chance to attach the
 * header the doorman wants, so the file has to be on this device first
 * (offline/covers.ts).
 *
 * Written once and shared, because getting it wrong in one place is invisible
 * — a cover that never loads looks exactly like a song that never had one,
 * which is how the library list kept its letter tiles for an hour.
 */
export function useArt(): (song: Song) => string | null {
  const { connection, fromCloud } = useConnection()
  const [covers, setCovers] = useState(coversNow)

  useEffect(() => onCoversChanged(() => setCovers(coversNow())), [])

  return useCallback(
    (song: Song): string | null => {
      if (!song.hasArt) return null
      // `fromCloud`, not `connection`: an address left over from talking to a
      // Mac is still stored, and asking whether one exists sends the loader to
      // a Mac that is not running.
      if (!fromCloud && connection) return mediaUrl.art(connection, song.id, song.rev)
      void ensureCover(song.id)
      return covers.get(song.id) ?? null
    },
    [connection, fromCloud, covers],
  )
}
