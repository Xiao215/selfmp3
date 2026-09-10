import { Router } from 'express'
import { z } from 'zod'
import {
  MigrateEnqueueSchema,
  MigrateMatchRequestSchema,
  MigrateParseRequestSchema,
  type MigrateEnqueueResult,
  type MigrateMatchJob,
  type MigrateParseResult,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithJobId = z.object({ id: z.string().uuid() })

/**
 * Migrating a playlist from another app.
 *
 * Three steps, each its own request: parse what was pasted (pure), match every
 * track against YouTube (a job, polled), then enqueue the chosen matches
 * through the ordinary import queue.
 */
export function migrateRoutes(container: Container): Router {
  const router = Router()

  router.post(
    '/migrate/parse',
    route({ body: MigrateParseRequestSchema }, async ({ body }): Promise<MigrateParseResult> => {
      let parsed: MigrateParseResult
      try {
        parsed = await container.migrate.parse(body.text)
      } catch (error) {
        throw HttpError.unprocessable(error instanceof Error ? error.message : String(error))
      }
      if (parsed.tracks.length === 0) {
        throw HttpError.badRequest(
          'no tracks found — paste one song per line, like "Artist - Title", or a CSV export',
        )
      }
      return parsed
    }),
  )

  router.post(
    '/migrate/match',
    route({ body: MigrateMatchRequestSchema }, async ({ body }): Promise<MigrateMatchJob> => {
      const tools = await container.ytdlp.status()
      if (!tools.ytdlp) {
        throw HttpError.failedDependency(
          'yt-dlp is not installed. Install it with: brew install yt-dlp ffmpeg',
        )
      }
      return container.migrate.startMatch(body.tracks)
    }),
  )

  router.get(
    '/migrate/match/:id',
    route({ params: ParamsWithJobId }, ({ params }): MigrateMatchJob => {
      const job = container.migrate.job(params.id)
      if (!job) throw HttpError.notFound('no such match job (they expire after an hour)')
      return job
    }),
  )

  router.post(
    '/migrate/match/:id/cancel',
    route({ params: ParamsWithJobId }, ({ params }) => {
      if (!container.migrate.cancel(params.id)) {
        throw HttpError.conflict('that match job has already finished')
      }
      return { ok: true as const }
    }),
  )

  router.post(
    '/migrate/enqueue',
    route({ body: MigrateEnqueueSchema }, ({ body }): MigrateEnqueueResult => {
      const tagIds = container.tags.exists(body.tagIds)

      // Reuse a manual playlist with the same name rather than making
      // "Road Trip (2)" every time the user migrates the same list again.
      let playlistId: number | null = null
      if (body.playlistName) {
        const wanted = body.playlistName.toLowerCase()
        const existing = container.playlists
          .all()
          .find(list => list.kind === 'manual' && list.name.toLowerCase() === wanted)
        playlistId =
          existing?.id ??
          container.playlists.create({
            name: body.playlistName,
            description: '',
            kind: 'manual',
            rules: null,
          }).id
        if (!existing) container.bumpLibraryVersion()
      }

      const fresh = body.items.filter(item => !container.imports.isPending(item.url))
      if (fresh.length === 0) {
        throw HttpError.conflict('those tracks are already in the queue')
      }

      const jobs = container.imports.enqueue(fresh, tagIds, playlistId)
      container.importQueue.kick()
      return { jobs, skipped: body.items.length - fresh.length, playlistId }
    }),
  )

  return router
}
