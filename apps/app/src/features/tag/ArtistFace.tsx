import type { ReactNode } from 'react'
import type { Artist, Song } from '@selfmp3/shared'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Cover } from '../../ui/components/Cover'
import { useArtistPicture } from './useArtistPicture'

/**
 * An artist's round face in a list: their picture from the server where it
 * has one (`useArtistPicture`), and until then — or offline, or for an artist
 * it found no page for — the cover of one of their own songs, cut round, so a
 * row is never a grey figure. Asked for only while drawn: a list of artists is
 * virtualised, so the server looks up the faces on screen, once each, and
 * keeps them.
 */
export function ArtistFace({
  artist,
  lead,
  size,
}: {
  artist: Artist
  /** One of their songs with a cover, for the face until the picture comes. */
  lead: Song | null
  size: number
}): ReactNode {
  const picture = useArtistPicture(artist.name)
  const artFor = useArt(ROW_COVER_SIZE)
  const uri = picture?.portrait ?? (lead ? artFor(lead) : null)
  return <Cover uri={uri} title={artist.name} size={size} radius={size / 2} />
}
