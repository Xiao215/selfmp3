import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'
import { mediaUrlFor } from '../api/client'
import { artAddress, serverRoutes } from '../api/mediaAddress.model'
import { bucketMedia } from '../ports/bucketMedia'
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
 * cannot be asked directly: the image loader is handed a URL and given no
 * chance to attach the header the doorman wants. So a cloud library's cover
 * comes from whatever this platform has that can attach it — the service
 * worker, in a browser, behind an address of the app's own (ports/bucketMedia)
 * — or else from a copy already on this device (offline/covers.ts), which is
 * all a phone has.
 *
 * Written once and shared, because getting it wrong in one place is invisible:
 * a cover that never loads looks exactly like a song that never had one.
 *
 * A screen renders again only when a cover it has asked for changes — not
 * whenever any cover arrives, which would render the library, the player bar
 * and every open sheet for one playlist tile's picture.
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
      // Whichever address this library has, if it has one. `fromCloud` decides,
      // not `connection`: an address left over from talking to a server is
      // still stored, and asking whether one exists sends the loader to a
      // server that is not running — or to another library's song 12.
      const address = artAddress(song.id, song.rev, {
        bucket: bucketMedia,
        server: connection ? serverRoutes(mediaUrlFor(connection), KEPT_COVER_SIZE) : null,
        fromCloud,
      })
      // A copy on this device, kept the moment the picture answers. It is what
      // is drawn once it exists: it is there when the network is not, and it is
      // the same picture when it is. A tab keeps none, and draws the address.
      if (fromCloud) void ensureCover(song.id)
      else if (address) void ensureServerCover(song.id, song.rev, address)
      return coverFor(song.id) ?? address
    },
    // `seen` is not read, but it is why this is a new function when one of
    // this screen's covers changes: a screen that memoizes on it (a
    // playlist's mosaic) must look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connection, fromCloud, watch, seen],
  )
}
