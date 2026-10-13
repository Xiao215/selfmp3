import type { MediaRoutes } from '../api/mediaAddress.model'
import type { BucketMediaSetup } from './bucketMedia.types'
import { doormanAuth, doormanFileUrl } from '../replica'

/**
 * Addresses this platform can have answered from the bucket, for a library
 * that came from there.
 *
 * On a phone a song's address is the doorman's own, `/v1/files/<key>`, and the
 * bearer goes with it as a header. The doorman reads a bearer header and
 * nothing else. An `<audio>` element is handed a URL and has no chance to
 * attach one, but the player this app uses takes headers with each track and
 * sends them on every request it makes for it, ranges included
 * (`ports/engine.ts`, `#trackFor`). So a cloud song that is not on the disk
 * streams, rather than waiting to be downloaded — which on a phone short of
 * room would mean not at all.
 *
 * The key is the song's `path`: a library read from the bucket names each file
 * by where it is there. Nothing here can know a song by its id alone, or hold a
 * session — a route is asked for synchronously, by an engine building a track —
 * so whoever owns the library and the sign-in tells it both (`configure`).
 * Until then, and for a song it has never heard of, the address is `''`, which
 * is what an engine refuses on: an honest "cannot play this" rather than a
 * request the doorman would turn away.
 *
 * Covers stay null. The lock screen draws a song's artwork from an address
 * with no way to send a header, so a phone keeps a bucket's covers as files,
 * fetched with the header on their own path (src/offline/covers.ts).
 *
 * A browser has somewhere else to put the header: its own service worker. That
 * is the web twin.
 */

const SIGNED_OUT: BucketMediaSetup = { pathOf: () => null, bearer: null }

let setup = SIGNED_OUT

/** Told by the player, which has the library and hears about sign-in. Null forgets both. */
export function configureBucketMedia(next: BucketMediaSetup | null): void {
  setup = next ?? SIGNED_OUT
}

/**
 * Where a bucket picture no song id names — an artist's — is drawn from.
 * Nowhere, on a phone: it keeps them as files, as it keeps covers.
 */
export function bucketPictureAddress(_key: string): string | null {
  return null
}

export const bucketMedia: MediaRoutes | null = {
  stream: songId => {
    const key = setup.bearer === null ? null : setup.pathOf(songId)
    return key === null ? '' : doormanFileUrl(key)
  },
  art: () => null,
  headers: () => (setup.bearer === null ? null : doormanAuth(setup.bearer)),
}
