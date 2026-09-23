import { useQuery } from '@tanstack/react-query'
import type { Artist } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { apiFor, mediaUrlFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'

/**
 * The address of an artist's picture — the one YouTube Music draws behind
 * their name — or null while there is none to draw.
 *
 * The picture is the server's: it has the YouTube Music client, and it keeps
 * the copy (routes/artists.ts). So this asks the server directly, the way
 * Stats does from a cloud library (`useServerDirect`), and from a library a
 * server is serving, that server. Nothing is kept on this device: the page
 * is lit by a song's cover until the picture answers, and stays lit by it
 * when the server is away, which is the page as it always was.
 */
export function useArtistBackdrop(artist: Artist | null): string | null {
  const { connection, fromCloud } = useConnection()
  const reach = useServerDirect({ enabled: fromCloud && artist !== null })
  const via: ServerConnection | undefined = fromCloud
    ? reach.state === 'reachable'
      ? reach.connection
      : undefined
    : (connection ?? undefined)
  const name = artist?.name ?? ''

  const { data } = useQuery({
    queryKey: ['via-server', via?.baseUrl, 'artist-backdrop', artist?.key],
    queryFn: () =>
      via ? apiFor(via).artistBackdrop(name) : Promise.reject(new Error('no server to ask')),
    enabled: via !== undefined && artist !== null,
    retry: false,
    // An answer holds for the session: the server keeps a picture once found,
    // and one it has none for is not asked about again for a week.
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (!via || !data?.rev) return null
  return mediaUrlFor(via).artistBackdrop(name, data.rev)
}
