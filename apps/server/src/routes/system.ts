import { Router } from 'express'
import { z } from 'zod'
import { StatsRangeSchema, UpdateSettingsSchema, type Health, type Stats } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { APP_VERSION } from '../config.js'

export function systemRoutes(container: Container): Router {
  const router = Router()

  /** Left unauthenticated so a monitor or launchd check does not need a token. */
  router.get(
    '/health',
    route({}, (): Health => ({
      ok: true,
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      libraryPath: container.config.libraryDir,
      storageDriver: container.storage.name,
      songCount: container.songs.count(),
    })),
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
