import type { Song } from '@selfmp3/shared'

/**
 * The cover the operating system's Now Playing card shows: the iPhone's lock
 * screen, Dynamic Island and Control Center, and Control Center on a Mac.
 *
 * The OS fetches the picture itself and can send no header, so the doorman's
 * covers — a signed-in library's only covers — can only be shown once a copy
 * is on this device. A copy wins whenever there is one: it is there with no
 * signal, and it is the same picture the app is drawing. A server's address is
 * next, for a server library whose cover has not been kept yet. A cloud
 * library never gets one: the last server's address is still stored after
 * signing in, and handed to the OS it drew nothing, or the last song's cover.
 *
 * Pure, so the rule is tested; the provider supplies the sources.
 */

export interface ArtSources {
  /** A copy of this song's cover already on the device (`coverFor`), if there is one. */
  readonly kept: string | undefined
  /** The server's address for a cover, or null when the library is not a server's. */
  readonly serverArt: ((songId: number, rev: string) => string) | null
}

export function nowPlayingArtwork(
  song: Pick<Song, 'id' | 'rev' | 'hasArt'>,
  sources: ArtSources,
): string | null {
  if (!song.hasArt) return null
  if (sources.kept) return sources.kept
  return sources.serverArt ? sources.serverArt(song.id, song.rev) : null
}
