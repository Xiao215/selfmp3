import { Router } from 'express'
import { z } from 'zod'
import {
  BooleanQuerySchema,
  ImportEnqueueSchema,
  ImportPreviewRequestSchema,
  type ImportPreview,
  type ImportPreviewItem,
  type ImportQueue,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithJobId = z.object({ id: z.string().uuid() })

/**
 * Importing.
 *
 * The flow is deliberately two-step: `preview` reads metadata without
 * downloading anything, the user corrects it, then `enqueue` commits. That
 * separation is what makes a 40-track playlist reviewable before it lands.
 */
export function importRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/import/tools',
    route(
      { query: z.object({ refresh: BooleanQuerySchema }) },
      async ({ query }) => container.ytdlp.status(query.refresh),
    ),
  )

  router.post(
    '/import/preview',
    route({ body: ImportPreviewRequestSchema }, async ({ body }): Promise<ImportPreview> => {
      const tools = await container.ytdlp.status()
      if (!tools.ytdlp) {
        throw HttpError.failedDependency(
          'yt-dlp is not installed. Install it with: brew install yt-dlp ffmpeg',
        )
      }

      // Accept several URLs at once, one per line.
      const urls = body.url
        .split(/[\s\n]+/)
        .map(part => part.trim())
        .filter(part => /^https?:\/\//i.test(part))
        .slice(0, 20)

      if (urls.length === 0) throw HttpError.badRequest('that does not look like a link')

      // An index of what is already here, so the UI can grey out duplicates.
      const existing = new Set(
        container.songs
          .all()
          .map(song => `${song.artist}::${song.title}`.toLowerCase()),
      )

      const items: ImportPreviewItem[] = []
      let kind: 'single' | 'playlist' = 'single'
      let playlistTitle: string | null = null

      for (const url of urls) {
        const probed = await container.ytdlp.probe(url)
        if (probed.kind === 'playlist') {
          kind = 'playlist'
          playlistTitle ??= probed.playlistTitle
        }
        for (const track of probed.tracks) {
          items.push({
            url: track.url,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            thumbnail: track.thumbnail,
            alreadyHave: existing.has(`${track.artist}::${track.title}`.toLowerCase()),
          })
        }
      }

      if (urls.length > 1) kind = 'playlist'
      return { kind, playlistTitle, items }
    }),
  )

  router.post(
    '/import/enqueue',
    route({ body: ImportEnqueueSchema }, ({ body }) => {
      const tagIds = container.tags.exists(body.tagIds)

      if (body.playlistId !== null) {
        const playlist = container.playlists.byId(body.playlistId)
        if (!playlist) throw HttpError.notFound('no such playlist')
        if (playlist.kind === 'smart') {
          throw HttpError.badRequest('imports cannot be added to a smart playlist')
        }
      }

      // Skip URLs already queued, so a double tap does not download twice.
      const fresh = body.items.filter(item => !container.imports.isPending(item.url))
      if (fresh.length === 0) {
        throw HttpError.conflict('those tracks are already in the queue')
      }

      const jobs = container.imports.enqueue(fresh, tagIds, body.playlistId)
      container.importQueue.kick()
      return { jobs, skipped: body.items.length - fresh.length }
    }),
  )

  router.get(
    '/import/queue',
    route(
      { query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }) },
      ({ query }): ImportQueue => {
        const counts = container.imports.counts()
        return {
          jobs: container.imports.recent(query.limit),
          active: counts.running,
          queued: counts.queued,
        }
      },
    ),
  )

  router.get(
    '/import/jobs/:id',
    route({ params: ParamsWithJobId }, ({ params }) => {
      const job = container.imports.byId(params.id)
      if (!job) throw HttpError.notFound('no such import job')
      return job
    }),
  )

  router.post(
    '/import/jobs/:id/cancel',
    route({ params: ParamsWithJobId }, ({ params }) => {
      if (!container.importQueue.cancel(params.id)) {
        throw HttpError.conflict('that job has already finished')
      }
      return { ok: true as const }
    }),
  )

  router.post(
    '/import/jobs/:id/retry',
    route({ params: ParamsWithJobId }, ({ params }) => {
      if (!container.importQueue.retry(params.id)) {
        throw HttpError.conflict('only a failed or cancelled job can be retried')
      }
      return { ok: true as const }
    }),
  )

  router.post(
    '/import/clear',
    route({}, () => ({ cleared: container.imports.clearFinished() })),
  )

  return router
}
