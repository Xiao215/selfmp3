import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { Song } from '@selfmp3/shared'
import { artAddress } from '../api/mediaAddress.model'
import { mediaSourcesFor } from '../api/mediaSources'
import { useConnection } from '../connection/ConnectionProvider'
import { watchCovers } from './coverChanges'
import {
  coverFailed,
  coverFor,
  coversVersion,
  ensureCover,
  ensureServerCover,
  KEPT_COVER_SIZE,
  keepsCovers,
  subscribeCovers,
} from './covers'

/**
 * What a cover is drawn from: an address, null for a song with no picture to
 * show (none at all, or one that could not be had), or undefined for one on
 * its way — a cloud cover this device is fetching — which `Cover` draws as a
 * quiet tile rather than as the letter a song without a picture gets.
 */
type Art = string | null | undefined

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
export function useArt(drawnAt: number = KEPT_COVER_SIZE): (song: Song) => Art {
  const { connection, fromCloud } = useConnection()
  const [watch] = useState(() =>
    watchCovers({ subscribe: subscribeCovers, version: coversVersion }),
  )
  const seen = useSyncExternalStore(watch.subscribe, watch.seen, watch.seen)
  // Built once per library rather than once per row per render.
  const kept = useMemo(
    () => mediaSourcesFor(connection, fromCloud, KEPT_COVER_SIZE),
    [connection, fromCloud],
  )
  const drawn = useMemo(
    () => (drawnAt === KEPT_COVER_SIZE ? kept : mediaSourcesFor(connection, fromCloud, drawnAt)),
    [kept, connection, fromCloud, drawnAt],
  )

  return useCallback(
    (song: Song): Art => {
      if (!song.hasArt) return null
      watch.ask(song.id)
      // Whichever address this library has, if it has one.
      const address = artAddress(song.id, song.rev, kept)
      // A copy on this device, kept the moment the picture answers. It is what
      // is drawn once it exists: it is there when the network is not, and it is
      // the same picture when it is. A tab keeps none, and draws the address.
      if (fromCloud) void ensureCover(song.id)
      else if (address) void ensureServerCover(song.id, song.rev, address)
      const onDevice = coverFor(song.id)
      if (onDevice) return onDevice
      // A song with a picture this device is still fetching: say it is coming,
      // so it is not drawn as a song without one and then swapped.
      if (!address) return fromCloud && keepsCovers && !coverFailed(song.id) ? undefined : null
      /*
       * Nothing kept — a browser tab — so what is drawn is the server's own
       * address, and it can be asked for the size actually being drawn.
       * The kept copy above is always `KEPT_COVER_SIZE`: a device that keeps
       * one keeps it sharp, and draws that rather than this.
       */
      return drawn === kept ? address : artAddress(song.id, song.rev, drawn)
    },
    // `seen` is not read, but it is why this is a new function when one of
    // this screen's covers changes: a screen that memoizes on it (a
    // playlist's mosaic) must look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromCloud, watch, seen, kept, drawn],
  )
}
