import type { Song } from '@selfmp3/shared'

/**
 * The cover the operating system's Now Playing card shows: the iPhone's lock
 * screen, Dynamic Island and Control Center, and Control Center on a Mac.
 *
 * The OS fetches the picture itself and can send no header, so a copy on this
 * device wins whenever there is one: it is there with no signal, and it is the
 * same picture the app is drawing. Otherwise this library's own address, which
 * is the server's for a server library and — in a browser, where the service
 * worker can attach the doorman's header — the app's own for a cloud one
 * (src/api/mediaAddress.model.ts). A phone has no such address for the bucket
 * and gets null, which is the honest answer: handing the OS the last server's
 * address, still stored after signing in, drew nothing or the last song's cover.
 *
 * Pure, so the rule is tested; the provider supplies the sources.
 */

export interface ArtSources {
  /** A copy of this song's cover already on the device (`coverFor`), if there is one. */
  readonly kept: string | undefined
  /** This library's address for a cover, or null where nothing here can serve one. */
  readonly remoteArt: (songId: number, rev: string) => string | null
}

export function nowPlayingArtwork(
  song: Pick<Song, 'id' | 'rev' | 'hasArt'>,
  sources: ArtSources,
): string | null {
  if (!song.hasArt) return null
  if (sources.kept) return sources.kept
  return sources.remoteArt(song.id, song.rev)
}
