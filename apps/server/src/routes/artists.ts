import { Router } from 'express'
import { z } from 'zod'
import { ArtistPictureShapeSchema, NameSchema, type ArtistBackdrop } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { sendStoredImage } from '../http/sendStoredImage.js'

/**
 * An artist's picture (services/artistBackdrops.ts).
 *
 * By name, as an artist is: nothing has an id for one. The first route says
 * whether there is a picture, finding one if it can — the only request that
 * goes out to YouTube Music — and the second serves the copy kept, as
 * `/art/:id` serves a cover: the banner, or the portrait cut square from it. A device signed in to the cloud reaches these
 * the way it reaches the stats: the server is the one with a YouTube Music
 * client, and an artist's page is lit by a song's cover when it is away.
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

  return router
}
