import { Directory, File, Paths } from 'expo-file-system'
import { PlaylistSongsSchema, type PlaylistSongs } from '@selfmp3/shared'

/**
 * Each playlist's last known members, on disk beside the library snapshot.
 *
 * `library.json` names every playlist and says how long it is, but which
 * songs are in one is a request of its own. Without a copy, a phone holding
 * every song could not open a playlist while its server was away — it knew "5
 * songs · 19 min" and could not name one. One small file per playlist, written
 * after every successful fetch and read only when a fetch fails.
 */

const CACHE_DIRECTORY = 'playlists'

function cacheDirectory(): Directory {
  return new Directory(Paths.document, CACHE_DIRECTORY)
}

function cacheFile(playlistId: number): File {
  return new File(cacheDirectory(), `${playlistId}.json`)
}

export async function readCachedPlaylist(playlistId: number): Promise<PlaylistSongs | null> {
  const file = cacheFile(playlistId)
  if (!file.exists) return null
  try {
    const parsed = PlaylistSongsSchema.safeParse(JSON.parse(await file.text()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedPlaylist(songs: PlaylistSongs): void {
  try {
    cacheDirectory().create({ intermediates: true, idempotent: true })
    cacheFile(songs.playlistId).write(JSON.stringify(songs))
  } catch {
    // A cache that cannot be written is a playlist that needs the server, not a failure.
  }
}

/** Forget them all: signing out, where another account's ids would collide. */
export async function clearCachedPlaylists(): Promise<void> {
  try {
    const directory = cacheDirectory()
    if (directory.exists) directory.delete()
  } catch {
    // Nothing to clear.
  }
}
