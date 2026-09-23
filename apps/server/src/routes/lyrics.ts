import { Router } from 'express'
import { z } from 'zod'
import type { LyricsSearchResponse } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * Lyrics+: lyric search.
 *
 * The lyrics themselves are served by `GET /songs/:id/lyrics`, romanized
 * lines and all; the index searched here is built from the same resolved
 * text, so whatever that route would show is what a search finds.
 */
export function lyricsRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/lyrics/search',
    route(
      {
        query: z.object({
          q: z.string().trim().max(200).default(''),
          limit: z.coerce.number().int().min(1).max(50).default(12),
        }),
      },
      ({ query }): LyricsSearchResponse => ({
        hits: query.q ? container.lyricsIndex.search(query.q, query.limit) : [],
      }),
    ),
  )

  return router
}
