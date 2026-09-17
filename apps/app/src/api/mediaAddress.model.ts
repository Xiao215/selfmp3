/**
 * Which address a song's bytes and cover are fetched from.
 *
 * Three places can answer, and which one does is a rule rather than a
 * preference:
 *
 *  1. **A file already on this device.** The download queue's copy wins over
 *     everything: it is the only thing that plays with no signal, and it is
 *     the same song either way.
 *  2. **The bucket**, for a library that came from it — through whatever this
 *     platform has that can attach the doorman's bearer header (the browser's
 *     service worker; see src/ports/bucketMedia.ts).
 *  3. **The server**, for a library the server is serving.
 *
 * 2 and 3 are exclusive, and that is the part worth writing down. A library
 * read from the bucket is not the server's library: the address of the last
 * server talked to is still stored after signing in to the cloud, and song 12
 * there is a different song. So a cloud library never asks a server, even one
 * that answers — the alternative is quietly playing the wrong track.
 *
 * Pure, so the rule can be tested on its own; each caller passes in the
 * addresses its platform actually has.
 */

import type { MediaUrl } from '@selfmp3/client'

/** One place's addresses for a song. `rev` defeats a cache when a file is replaced. */
export interface MediaRoutes {
  /** `''` when this place has no address for the song, which an engine refuses on. */
  readonly stream: (songId: number, rev?: string) => string
  /** Null where covers do not come by address — a phone keeps a bucket's as files. */
  readonly art: (songId: number, rev?: string) => string | null
  /**
   * What a request to `stream` has to carry, where an address alone is not
   * enough. Only the phone's bucket routes have any: the doorman wants a
   * bearer, and the phone's player can send one (ports/bucketMedia.ts).
   */
  readonly headers?: () => Readonly<Record<string, string>> | null
}

/**
 * A connected server's addresses as routes.
 *
 * Only the cover size has to be decided here: a server resizes a cover and
 * nothing else does, so asking it for one size everywhere is what lets a kept
 * copy and a drawn address be the same picture. Without one, the original —
 * which is what a caller that only wants to play something should pass.
 */
export function serverRoutes(
  media: Pick<MediaUrl, 'stream' | 'art'>,
  coverSize?: number,
): MediaRoutes {
  return {
    stream: (songId, rev) => media.stream(songId, rev),
    art: (songId, rev) => media.art(songId, rev, coverSize),
  }
}

export interface MediaSources {
  /** A file the download queue keeps on this device, if it keeps one. */
  readonly local: string | null
  /** Addresses this platform can have answered from the bucket, or null where it has none. */
  readonly bucket: MediaRoutes | null
  /** The connected server's addresses, or null when no server is connected. */
  readonly server: MediaRoutes | null
  /** Whether the library on this device came from the bucket. */
  readonly fromCloud: boolean
}

/** The one remote place this library's media may be fetched from, if there is one. */
function remote(sources: Omit<MediaSources, 'local'>): MediaRoutes | null {
  return sources.fromCloud ? sources.bucket : sources.server
}

/**
 * Where to play a song from; `''` when this device has nowhere to play it from,
 * which is what an engine is told and refuses on.
 */
export function streamAddress(
  songId: number,
  rev: string | undefined,
  sources: MediaSources,
): string {
  if (sources.local) return sources.local
  return remote(sources)?.stream(songId, rev) ?? ''
}

/**
 * The headers that go with `streamAddress`, decided by the same rule so the two
 * cannot disagree: a file on this device is read, not requested, and takes
 * none — sending the doorman's bearer along with a `file://` address would be
 * harmless, and sending it to a server that happened to answer would not.
 */
export function streamHeaders(sources: MediaSources): Readonly<Record<string, string>> | null {
  if (sources.local) return null
  return remote(sources)?.headers?.() ?? null
}

/** Where to draw a song's cover from, or null when nothing here can serve it. */
export function artAddress(
  songId: number,
  rev: string | undefined,
  sources: Omit<MediaSources, 'local'>,
): string | null {
  return remote(sources)?.art(songId, rev) ?? null
}
