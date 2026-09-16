import type { Song } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'

import { mediaUrlFor } from '../api/client'
import { cloudPlatform, session as cloudSession } from '../replica'

/**
 * Where a song's bytes come from.
 *
 * The bucket, through the doorman, when this device is signed in — with a
 * header, since that is all the doorman reads, and `song.path` is already the
 * key there. Otherwise a server, where the token has to ride in the query
 * string: the same URL is handed to the OS audio player, which cannot attach
 * headers.
 *
 * Policy, not storage, which is why it is here and not in either
 * `downloadStorage`: the phone and the desktop shell keep their bytes in very
 * different places and reach for them the same way. `connection` is passed in
 * because each storage keeps its own.
 */
export async function sourceFor(
  song: Song,
  connection: ServerConnection | null,
): Promise<{ url: string; headers?: Record<string, string> }> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  if (signedIn) {
    return {
      url: `${cloudPlatform.doormanUrl}/v1/files/${song.path}`,
      headers: { Authorization: `Bearer ${signedIn.token}` },
    }
  }
  if (!connection) throw new Error('no server, and not signed in to the cloud')
  return { url: mediaUrlFor(connection).stream(song.id) }
}
