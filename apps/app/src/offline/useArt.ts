import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrlFor } from '../api/client'
import { useConnection } from '../connection/ConnectionProvider'
import { watchCovers } from './coverChanges'
import {
  coverFor,
  coversVersion,
  ensureCover,
  ensureServerCover,
  KEPT_COVER_SIZE,
  subscribeCovers,
} from './covers'

/**
 * Where a song's artwork comes from, for whichever screen is asking.
 *
 * A server serves it over HTTP with the token in the query string. The bucket
 * cannot: the image loader is handed a URL and given no chance to attach the
 * header the doorman wants, so the file has to be on this device first
 * (offline/covers.ts).
 *
 * Written once and shared, because getting it wrong in one place is invisible
 * — a cover that never loads looks exactly like a song that never had one,
 * which is how the library list kept its letter tiles for an hour.
 *
 * A screen renders again only when a cover it has asked for changes. It used
 * to keep a copy of every cover on the device and replace it whenever any
 * arrived, so one playlist tile's picture rendered the library, the player bar
 * and every open sheet — each copying thousands of entries to do it.
 */
export function useArt(): (song: Song) => string | null {
  const { connection, fromCloud } = useConnection()
  const [watch] = useState(() =>
    watchCovers({ subscribe: subscribeCovers, version: coversVersion }),
  )
  const seen = useSyncExternalStore(watch.subscribe, watch.seen, watch.seen)

  return useCallback(
    (song: Song): string | null => {
      if (!song.hasArt) return null
      watch.ask(song.id)
      // `fromCloud`, not `connection`: an address left over from talking to a
      // server is still stored, and asking whether one exists sends the loader to
      // a server that is not running.
      if (!fromCloud && connection) {
        // The server's address, and a copy kept on this device the moment it
        // answers. The copy is what is drawn once it exists: it is there when
        // the server is not, and it is the same picture when it is.
        const url = mediaUrlFor(connection).art(song.id, song.rev, KEPT_COVER_SIZE)
        void ensureServerCover(song.id, song.rev, url)
        return coverFor(song.id) ?? url
      }
      void ensureCover(song.id)
      return coverFor(song.id) ?? null
    },
    // `seen` is not read, but it is why this is a new function when one of
    // this screen's covers changes: a screen that memoizes on it (a
    // playlist's mosaic) must look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection, fromCloud, watch, seen],
  )
}
