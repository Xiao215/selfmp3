import { PlaylistSongsSchema, type PlaylistSongs } from '@selfmp3/shared'
import { deleteStoredPrefix, readStored, writeStored } from '../ports/idbStore.web'

/**
 * The browser's copy of each playlist's members: one IndexedDB record per
 * playlist, beside the library snapshot. See `playlistCache.ts`.
 */

const KEY_PREFIX = 'playlist-songs-'

export async function readCachedPlaylist(playlistId: number): Promise<PlaylistSongs | null> {
  try {
    const stored = (await readStored(`${KEY_PREFIX}${playlistId}`)) as { songs?: unknown } | null
    if (!stored) return null
    const parsed = PlaylistSongsSchema.safeParse(stored.songs)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeCachedPlaylist(songs: PlaylistSongs): void {
  void writeStored(`${KEY_PREFIX}${songs.playlistId}`, { savedAt: Date.now(), songs }).catch(
    () => undefined,
  )
}

/** Forget them all: signing out, where another account's ids would collide. */
export function clearCachedPlaylists(): Promise<void> {
  return deleteStoredPrefix(KEY_PREFIX)
}
