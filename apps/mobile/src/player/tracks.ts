import type { Track } from 'react-native-track-player'
import type { Song } from '@selfmp3/shared'
import { mediaUrl } from '../api/client'
import type { ServerConnection } from '../server/connection'

/**
 * Turning a song into something react-native-track-player can play.
 *
 * The local file wins whenever one exists. That is the whole point of the
 * download queue: in a car park with no signal the app should still play, and
 * it should not spend mobile data on a file it already has.
 */

/** A Track that carries the song id, so events can map back to the library. */
export interface SongTrack extends Track {
  readonly songId: number
}

export function toTrack(
  song: Song,
  connection: ServerConnection,
  localUri: string | null,
): SongTrack {
  return {
    songId: song.id,
    // A stable id lets the native side dedupe; RNTP passes unknown keys
    // through untouched.
    id: String(song.id),
    url: localUri ?? mediaUrl.stream(connection, song.id),
    title: song.title,
    artist: song.artist,
    album: song.album,
    // Art always comes from the server: it is small, cached by the OS image
    // loader, and not worth a second offline store.
    artwork: song.hasArt ? mediaUrl.art(connection, song.id) : undefined,
    duration: song.duration > 0 ? song.duration : undefined,
    contentType: song.mime,
    isLiveStream: false,
  }
}

/** The song id a track came from, or null for anything we did not queue. */
export function songIdOf(track: Track | undefined | null): number | null {
  if (!track) return null
  const raw: unknown = track['songId']
  return typeof raw === 'number' ? raw : null
}
