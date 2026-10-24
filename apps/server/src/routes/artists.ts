import { Router } from 'express'
import { z } from 'zod'
import {
  ArtistPictureShapeSchema,
  NameSchema,
  SetArtistNamesSchema,
  findArtist,
  tidyArtistNames,
  type ArtistBackdrop,
  type SetArtistNames,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { sendStoredImage } from '../http/sendStoredImage.js'

/**
 * An artist's picture (services/artistBackdrops.ts), and the names they also go by.
 *
 * By name, as an artist is: nothing has an id for one. The first route says
 * whether there is a picture, finding one if it can — the only request that
 * goes out to YouTube Music — and the second serves the copy kept, as
 * `/art/:id` serves a cover: the banner, or the portrait cut square from it.
 * A device signed in to the cloud reaches these the way it reaches the stats:
 * the server is the one with a YouTube Music client, and an artist's page is
 * lit by a song's cover when it is away.
 */
export function artistRoutes(container: Container): Router {
  const router = Router()
  const ByName = z.object({ name: NameSchema })
  const ByNameAndShape = ByName.extend({ shape: ArtistPictureShapeSchema.default('banner') })

  router.get(
    '/artists/backdrop',
    route({ query: ByName }, async ({ query }): Promise<ArtistBackdrop> => {
      const found = await container.artistBackdrops.find(query.name)
      return { rev: found?.rev ?? null }
    }),
  )

  router.get(
    '/artists/backdrop/image',
    route({ query: ByNameAndShape }, async ({ query, req, res }) => {
      const kept = await container.artistBackdrops.kept(query.name, query.shape)
      if (!kept) throw HttpError.notFound('no picture for this artist')
      await sendStoredImage(req, res, kept)
      return undefined
    }),
  )

  /**
   * The names an artist also goes by, all of them as they should be now:
   * search finds the artist by these (packages/shared/src/searchNames.ts).
   * Stamped as any edit is, so the latest change wins wherever it was made.
   */
  router.put(
    '/artists/names',
    route({ body: SetArtistNamesSchema }, ({ body }): SetArtistNames => {
      const artist = findArtist(container.songs.all(), body.artist)
      if (!artist) throw HttpError.notFound('no such artist')
      const names = tidyArtistNames(artist.name, body.names)
      container.names.takeArtistNames(artist.key, names, container.clock.tick())
      container.bumpLibraryVersion()
      return { artist: artist.key, names }
    }),
  )

  return router
}
