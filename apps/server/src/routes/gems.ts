import { Router } from 'express'
import { z } from 'zod'
import type { ForgottenGems } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * Forgotten gems: loved or well-played songs that have gone quiet.
 *
 * The repository ranks ids; the songs are resolved through the song
 * repository so the payload is the same `Song` shape the library uses.
 */
export function gemsRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/library/gems',
    route(
      { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
      ({ query }): ForgottenGems => {
        const minDays = container.gems.thresholdDays()
        const songs = container.gems
          .pick(minDays, query.limit)
          .map(gem => container.songs.byId(gem.songId))
          .filter(song => song !== null)
        return {
          songs,
          minDays,
          total: container.gems.count(minDays),
          generatedAt: new Date().toISOString(),
        }
      },
    ),
  )

  return router
}
