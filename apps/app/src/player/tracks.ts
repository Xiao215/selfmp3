import type { Track } from 'react-native-track-player'
import type { Song } from '@selfmp3/shared'
import { mediaUrlFor } from '../api/client'
import type { ServerConnection } from '../server/connection'

/**
 * Turning a song into something react-native-track-player can play.
 *
 * The local file wins whenever one exists. That is the whole point of the
 * download queue: in a car park with no signal the app should still play, and
 * it should not spend mobile data on a file it already has.
 *
 * From the bucket there is no second option. The OS audio player is handed a
 * URL and cannot attach a header, while the doorman reads the bearer header
 * and nothing else — so a song is playable exactly when it is on this device,
 * which is also rule five of docs/SYNC.md for an installed app. `toTrack`
 * answers null for one that is not, rather than handing the player a URL that
 * would come back 401.
 */

/** A Track that carries the song id, so events can map back to the library. */
export interface SongTrack extends Track {
  readonly songId: number
}

export function toTrack(
  song: Song,
  connection: ServerConnection | null,
  localUri: string | null,
): SongTrack | null {
  if (!localUri && !connection) return null
  return {
    songId: song.id,
    // A stable id lets the native side dedupe; RNTP passes unknown keys
    // through untouched.
    id: String(song.id),
    url: localUri ?? mediaUrlFor(connection as ServerConnection).stream(song.id, song.rev),
    title: song.title,
    artist: song.artist,
    album: song.album,
    // Art comes from a server when there is one. From the bucket it would need
    // the same header the loader cannot send, so a bucket song shows none
    // until covers are downloaded alongside the audio.
    artwork: song.hasArt && connection ? mediaUrlFor(connection).art(song.id, song.rev) : undefined,
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
