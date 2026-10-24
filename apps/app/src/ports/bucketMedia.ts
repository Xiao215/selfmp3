import type { MediaRoutes } from '../api/mediaAddress.model'
import type { BucketMediaSetup } from './bucketMedia.types'
import { doormanAuth, doormanFileUrl } from '../replica'
import { streamOnce } from './recentCopies'

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
 * Not straight from the doorman, though, where the app's loopback server is
 * built in (`songStream.ts`): every range the player asks for would be a read
 * of the bucket, against a daily allowance. The address is the server's, which
 * downloads the song once into the played-songs folder and answers every range
 * from that (`recentCopies.ts`, `streamOnce`). The bearer still goes with the
 * track; the server ignores it, and `askWhyRefused` sends it on asking why a
 * song would not play, which the server answers with the doorman's words.
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
 * A browser has somewhere else to put the header: its own service worker. The
 * desktop app has its shell. Both are the web twin.
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
    const { bearer } = setup
    const key = bearer === null ? null : setup.pathOf(songId)
    if (bearer === null || key === null) return ''
    const url = doormanFileUrl(key)
    return streamOnce({ id: songId, path: key }, url, doormanAuth(bearer)) ?? url
  },
  art: () => null,
  headers: () => (setup.bearer === null ? null : doormanAuth(setup.bearer)),
}
