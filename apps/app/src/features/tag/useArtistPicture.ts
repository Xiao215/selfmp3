import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { artistKey } from '@selfmp3/shared'
import type { ServerConnection } from '@selfmp3/client'
import { apiFor, mediaUrlFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { noServer, viaKey } from '../../connection/via'
import {
  ensurePicture,
  keepsCovers,
  pictureFor,
  picturesVersion,
  subscribePictures,
} from '../../offline/covers'
import { bucketPictureAddress } from '../../ports/bucketMedia'
import { library as cloudLibrary } from '../../replica'

/** An artist's picture, in both the shapes the server keeps it. */
interface ArtistPicture {
  /** The wide one YouTube Music draws behind their name: an artist page's light. */
  readonly banner: string
  /** The same cut square: the face beside their name in Stats. */
  readonly portrait: string
}

/**
 * The addresses of an artist's picture: undefined while it is on its way,
 * null when there is none to be had.
 *
 * The server finds every artist's picture (services/artistBackdrops.ts) and
 * puts it in the bucket beside the covers, and the snapshot names it. So a
 * cloud library has it as it has a cover: kept on this device once fetched,
 * there with no server in reach, and drawn in a browser tab through the
 * service worker. A library a server is serving asks that server. Until the
 * picture answers, and for an artist with none, an artist's page is lit by a
 * song's cover, which is the page as it always was.
 */
export function useArtistPicture(name: string | null): ArtistPicture | null | undefined {
  const { connection, fromCloud } = useConnection()
  const fromBucket = useBucketPicture(fromCloud ? name : null)
  const fromServer = useServerPicture(fromCloud ? null : name, connection)
  return fromCloud ? fromBucket : fromServer
}

function useBucketPicture(name: string | null): ArtistPicture | null | undefined {
  const keys = useSyncExternalStore(cloudLibrary.onCloudLibraryChanged, () =>
    name === null ? null : cloudLibrary.cloudArtistPictureNow(name),
  )
  // Read so that a picture arriving draws again; the value itself is not needed.
  useSyncExternalStore(subscribePictures, picturesVersion)
  const [failed, setFailed] = useState<string | null>(null)
  const banner = keys && keepsCovers ? pictureFor(keys.banner) : undefined
  const portrait = keys && keepsCovers ? pictureFor(keys.portrait) : undefined

  useEffect(() => {
    if (!keys || !keepsCovers || (banner && portrait)) return
    let cancelled = false
    void Promise.all([ensurePicture(keys.banner), ensurePicture(keys.portrait)]).then(
      ([gotBanner, gotPortrait]) => {
        // Not had now — the bucket refused, say — is the cover until the next ask.
        if (!cancelled && (!gotBanner || !gotPortrait)) setFailed(keys.banner)
      },
    )
    return () => {
      cancelled = true
    }
  }, [keys, banner, portrait])

  if (name === null || keys === null) return null
  if (keys === undefined) return undefined
  if (!keepsCovers) {
    // A tab keeps no files: the service worker answers for the bucket.
    const bannerAddress = bucketPictureAddress(keys.banner)
    const portraitAddress = bucketPictureAddress(keys.portrait)
    return bannerAddress && portraitAddress
      ? { banner: bannerAddress, portrait: portraitAddress }
      : null
  }
  if (banner && portrait) return { banner, portrait }
  return failed === keys.banner ? null : undefined
}

function useServerPicture(
  name: string | null,
  server: ServerConnection | null,
): ArtistPicture | null | undefined {
  const { data, isPending, isError } = useQuery({
    queryKey: viaKey(server?.baseUrl, 'artist-backdrop', artistKey(name ?? '')),
    queryFn: () => (server && name !== null ? apiFor(server).artistBackdrop(name) : noServer()),
    enabled: server !== null && name !== null,
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
