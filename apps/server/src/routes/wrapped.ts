import { Router } from 'express'
import { z } from 'zod'
import { WrappedRangeSchema, ZoneQuerySchema, type Wrapped } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { readerZone } from '../repositories/listening.js'

/** "Wrapped, anytime": the listening summary for a rolling window. */
export function wrappedRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/stats/wrapped',
    route(
      { query: z.object({ range: WrappedRangeSchema.default('month'), zone: ZoneQuerySchema }) },
      ({ query }): Wrapped => container.wrapped.build(query.range, readerZone(query.zone)),
    ),
  )

  return router
}
