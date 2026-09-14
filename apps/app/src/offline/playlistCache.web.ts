import { PlaylistSongsSchema, type PlaylistSongs } from '@selfmp3/shared'
import { deleteStored, readStored, writeStored } from '../ports/idbStore.web'

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

/**
 * Forget them: signing out, where another account's ids would collide. The
 * store lists no keys, so the ids come from the library being forgotten.
 */
export function clearCachedPlaylists(playlistIds: readonly number[] = []): void {
  for (const id of playlistIds) {
    void deleteStored(`${KEY_PREFIX}${id}`).catch(() => undefined)
  }
}
