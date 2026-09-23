import fs from 'node:fs'
import { Router } from 'express'
import { z } from 'zod'
import { NameSchema, type ArtistBackdrop } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

/**
 * An artist's picture (services/artistBackdrops.ts).
 *
 * By name, as an artist is: nothing has an id for one. The first route says
 * whether there is a picture, finding one if it can — the only request that
 * goes out to YouTube Music — and the second serves the copy kept, as
 * `/art/:id` serves a cover. A device signed in to the cloud reaches these
 * the way it reaches the stats: the server is the one with a YouTube Music
 * client, and an artist's page is lit by a song's cover when it is away.
 */
export function artistRoutes(container: Container): Router {
  const router = Router()
  const ByName = z.object({ name: NameSchema })

  router.get(
    '/artists/backdrop',
    route({ query: ByName }, async ({ query }): Promise<ArtistBackdrop> => {
      const found = await container.artistBackdrops.find(query.name)
      return { rev: found?.rev ?? null }
    }),
  )

  router.get(
    '/artists/backdrop/image',
    route({ query: ByName }, async ({ query, req, res }) => {
      const kept = container.artistBackdrops.kept(query.name)
      if (!kept) throw HttpError.notFound('no picture for this artist')

      const stat = fs.statSync(kept.path)
      const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
      const caching = {
        'Content-Type': kept.contentType,
        ETag: etag,
        'Cache-Control': 'private, max-age=604800',
      }
      if (req.headers['if-none-match'] === etag) {
        res.set(caching).status(304).end()
        return undefined
      }

      // Awaited, and the headers handed to `sendFile`, for the reasons the
      // cover route gives (routes/media.ts).
      await new Promise<void>((resolve, reject) => {
        res.sendFile(kept.path, { dotfiles: 'allow', headers: caching }, error =>
          error ? reject(error) : resolve(),
        )
      })
      return undefined
    }),
  )

  return router
}
