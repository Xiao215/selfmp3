import { useQuery } from '@tanstack/react-query'
import { artistKey } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { apiFor, mediaUrlFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { noServer, reachedConnection, viaKey } from '../../connection/via'

/** An artist's picture, in both the shapes the server keeps it. */
interface ArtistPicture {
  /** The wide one YouTube Music draws behind their name: an artist page's light. */
  readonly banner: string
  /** The same cut square: the face beside their name in Stats. */
  readonly portrait: string
}

/**
 * The addresses of an artist's picture: undefined while the server is being
 * asked, null when it has none or there is no server to ask.
 *
 * The picture is the server's: it has the YouTube Music client, and it keeps
 * the copy (routes/artists.ts). So this asks the server directly, the way
 * Stats does from a cloud library (`useServerDirect`), and from a library a
 * server is serving, that server. A screen that has already reached it passes
 * it as `via`. Nothing is kept on this device: an artist page is lit by a
 * song's cover until the picture answers, and stays lit by it when the
 * server is away, which is the page as it always was.
 */
export function useArtistPicture(
  name: string | null,
  via?: ServerConnection,
): ArtistPicture | null | undefined {
  const { connection, fromCloud } = useConnection()
  const reach = useServerDirect({ enabled: fromCloud && via === undefined && name !== null })
  const server: ServerConnection | undefined =
    via ?? (fromCloud ? reachedConnection(reach) : (connection ?? undefined))

  const { data, isPending, isError } = useQuery({
    queryKey: viaKey(server?.baseUrl, 'artist-backdrop', artistKey(name ?? '')),
    queryFn: () => (server && name !== null ? apiFor(server).artistBackdrop(name) : noServer()),
    enabled: server !== undefined && name !== null,
    retry: false,
    // An answer holds for the session: the server keeps a picture once found,
    // and one it has none for is not asked about again for a week.
    staleTime: Number.POSITIVE_INFINITY,
    // A few bytes each, and one dropped meant the face blinking out and back
    // the next time the page opened.
    gcTime: Number.POSITIVE_INFINITY,
  })

  if (!server || name === null || isError) return null
  if (isPending) return undefined
  if (!data.rev) return null
  const media = mediaUrlFor(server)
  return {
    banner: media.artistPicture(name, data.rev, 'banner'),
    portrait: media.artistPicture(name, data.rev, 'portrait'),
  }
}
