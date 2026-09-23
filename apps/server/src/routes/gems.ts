import { Router } from 'express'
import { z } from 'zod'
import { forgottenGems, type ForgottenGems } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * Forgotten gems: loved or well-played songs that have gone quiet.
 *
 * The rule is `forgottenGems` in `@selfmp3/shared`, run over the whole library
 * here as a device runs it over its cloud library — one ranking, wherever the
 * shelf is drawn.
 */
export function gemsRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/library/gems',
    route(
      { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }) },
      ({ query }): ForgottenGems => {
        const { gems, minDays, total } = forgottenGems(container.songs.all(), {
          limit: query.limit,
        })
        return {
          songs: gems.map(gem => gem.song),
          minDays,
          total,
          generatedAt: new Date().toISOString(),
        }
      },
    ),
  )

  return router
}
