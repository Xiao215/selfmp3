import { Router } from 'express'
import { z } from 'zod'
import { WrappedRangeSchema, type Wrapped } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/** "Wrapped, anytime": the listening summary for a rolling window. */
export function wrappedRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/stats/wrapped',
    route(
      { query: z.object({ range: WrappedRangeSchema.default('month') }) },
      ({ query }): Wrapped => container.wrapped.build(query.range),
    ),
  )

  return router
}
