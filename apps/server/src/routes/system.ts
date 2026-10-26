import { Router } from 'express'
import { z } from 'zod'
import {
  StatsRangeSchema,
  UpdateSettingsSchema,
  type Health,
  type Stats,
  type UsualHours,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { isAuthenticated } from '../http/middleware.js'
import { APP_VERSION } from '../config.js'
import { USUAL_DAYS, usualHours } from '../services/usualHours.js'

export function systemRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/health',
    route({}, ({ req }): Health => {
      // Answered without a token so a monitor, launchd or a container
      // healthcheck needs no secret — which means whoever can reach the port
      // hears this. Where the music lives, and how much of it there is,
      // describe the library rather than the service, and are held back from
      // an asker who has not authenticated.
      const known = isAuthenticated(req, container.config)
      return {
        ok: true,
        version: APP_VERSION,
        serverId: container.serverId,
        uptimeSeconds: Math.round(process.uptime()),
        appUrl: container.config.appUrl,
        ...(known
          ? { libraryPath: container.config.libraryDir, songCount: container.songs.count() }
          : {}),
      }
    }),
  )

  router.get(
    '/settings',
    route({}, () => container.settings.get()),
  )

  router.patch(
    '/settings',
    route({ body: UpdateSettingsSchema }, ({ body }) => {
      const updated = container.settings.update(body)
      // Concurrency may have changed; let the queue pick up the new limit.
      container.importQueue.kick()
      // Folder watching switches on or off immediately, no restart needed.
      container.libraryWatcher.apply()
      return updated
    }),
  )

  router.get(
    '/stats',
    route({ query: z.object({ range: StatsRangeSchema.default('30d') }) }, ({ query }): Stats =>
      container.stats.build(query.range),
    ),
  )

  /**
   * What you usually play at each hour, for Home's hour tile. `offset` is the
   * asking device's clock against UTC in minutes, east positive, so the hours
   * are its own.
   */
  router.get(
    '/stats/usual',
    route(
      { query: z.object({ offset: z.coerce.number().int().min(-900).max(900).default(0) }) },
      ({ query }): UsualHours => usualHours(container.stats.usualPlays(query.offset, USUAL_DAYS)),
    ),
  )

  return router
}
