import { Router } from 'express'
import { z } from 'zod'
import { StatsRangeSchema, UpdateSettingsSchema, type Health, type Stats } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { isAuthenticated } from '../http/middleware.js'
import { APP_VERSION } from '../config.js'

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
        uptimeSeconds: Math.round(process.uptime()),
        storageDriver: container.storage.name,
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

  /** Recent plays, joined to song titles for the history list. */
  router.get(
    '/stats/history',
    route(
      { query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) },
      ({ query }) => {
        const events = container.stats.recent(query.limit)
        return {
          events: events.map(event => {
            const song = container.songs.byId(event.songId)
            return {
              songId: event.songId,
              title: song?.title ?? 'Deleted song',
              artist: song?.artist ?? '',
              hasArt: song?.hasArt ?? false,
              playedAt: event.playedAt,
              completed: event.completed,
            }
          }),
        }
      },
    ),
  )

  return router
}
