import { Router } from 'express'
import { UsageReportSchema, type Ok } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * `POST /api/usage`: a device's counts for one day, sent once a day while
 * "Count features I use" is on (Settings › About). Added to the day's totals
 * for the owner's admin page and nothing else kept: not the device, not the
 * library it came through (docs/features/admin.md).
 */
export function usageRoutes(container: Container): Router {
  const router = Router()
  router.post(
    '/usage',
    route({ body: UsageReportSchema }, ({ body }): Ok => {
      // A day the server will not keep (a clock far off) is still answered
      // the same: there is nothing a device could do about it.
      container.metrics.addReport(body)
      return { ok: true }
    }),
  )
  return router
}
