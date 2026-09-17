import type { MediaRoutes } from '../api/mediaAddress.model'
import { cloudPlatform } from '../replica'

/**
 * Addresses this platform can have answered from the bucket, for a library
 * that came from there.
 *
 * On a phone a song's address is the doorman's own, `/v1/files/<key>`, and the
 * bearer goes with it as a header. The doorman reads a bearer header and
 * nothing else, and for a long time this file said a phone therefore could not
 * stream at all: an OS audio player is handed a URL and has no chance to attach
 * one. That is true of an `<audio>` element. It is not true of the player this
 * app uses, which takes headers with each track and sends them on every request
 * it makes for it, ranges included (`ports/engine.ts`, `#trackFor`). So a cloud
 * song that is not on the disk streams, where it used to be refused until it
 * had been downloaded — which on a phone short of room meant not at all.
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

interface BucketMediaSetup {
  /** A song's key in the bucket, or null for one this library does not have. */
  readonly pathOf: (songId: number) => string | null
  /** The doorman session's token, or null while signed out. */
  readonly bearer: string | null
}

const SIGNED_OUT: BucketMediaSetup = { pathOf: () => null, bearer: null }

let setup = SIGNED_OUT

/** Told by the player, which has the library and hears about sign-in. Null forgets both. */
export function configureBucketMedia(next: BucketMediaSetup | null): void {
  setup = next ?? SIGNED_OUT
}

export const bucketMedia: MediaRoutes | null = {
  stream: songId => {
    const key = setup.bearer === null ? null : setup.pathOf(songId)
    return key === null ? '' : `${cloudPlatform.doormanUrl}/v1/files/${key}`
  },
  art: () => null,
  headers: () => (setup.bearer === null ? null : { Authorization: `Bearer ${setup.bearer}` }),
}
