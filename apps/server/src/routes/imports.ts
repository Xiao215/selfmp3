import { Router } from 'express'
import { z } from 'zod'
import {
  BooleanQuerySchema,
  ImportEnqueueSchema,
  ImportPreviewRequestSchema,
  ImportShareRequestSchema,
  YT_LIKED_MUSIC_URL,
  type ImportEnqueueItem,
  type ImportEnqueueResult,
  type ImportPreview,
  type ImportQueue,
  type ImportShareResult,
  type YtCookieTest,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { buildImportPreview, resolveImportPlaylist } from '../services/importPreview.js'

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

  /** Queue what is not already queued, so a double tap does not download twice. */
  const enqueueFresh = (
    items: readonly ImportEnqueueItem[],
    tagIds: readonly number[],
    playlistId: number | null,
  ): ImportEnqueueResult => {
    const fresh = items.filter(item => !container.imports.isPending(item.url))
    if (fresh.length === 0) {
      throw HttpError.conflict('those tracks are already in the queue')
    }
    const jobs = container.imports.enqueue(fresh, tagIds, playlistId)
    container.importQueue.kick()
    return { jobs, skipped: items.length - fresh.length, playlistId }
  }

  router.post(
    '/import/preview',
    route({ body: ImportPreviewRequestSchema }, ({ body }): Promise<ImportPreview> =>
      buildImportPreview(container, body.url),
    ),
  )

  router.post(
    '/import/enqueue',
    route({ body: ImportEnqueueSchema }, ({ body }): ImportEnqueueResult => {
      const tagIds = container.tags.exists(body.tagIds)
      const playlist = resolveImportPlaylist(container.playlists, body)
      const result = enqueueFresh(body.items, tagIds, playlist?.id ?? null)
      // A playlist may have just been created; let clients refetch the list.
      if (playlist && body.playlistId === null) container.bumpLibraryVersion()
      return result
    }),
  )

  /**
   * Share-sheet import: probe and enqueue in one request.
   *
   * iOS has no Web Share Target, so a Shortcut posts the shared link here and
   * gets the created jobs back. The default import tags from settings are
   * applied so the result matches what the interactive flow would have done.
   * Mounted at both `/import/share` (this file's convention) and
   * `/imports/share` (the documented name), since a Shortcut is fiddly to edit.
   */
  const share = route(
    { body: ImportShareRequestSchema },
    async ({ body }): Promise<ImportShareResult> => {
      const preview = await buildImportPreview(container, body.url)
      const items = preview.items.filter(item => !item.alreadyHave)
      if (items.length === 0) {
        throw HttpError.conflict('everything in that link is already in your library')
      }

      const settings = container.settings.get()
      const tagIds = container.tags.exists([
        ...new Set([...body.tagIds, ...settings.defaultImportTagIds]),
      ])
      const playlist = resolveImportPlaylist(container.playlists, {
        playlistId: null,
        createPlaylistName:
          body.createPlaylist && preview.kind === 'playlist' ? preview.playlistTitle : null,
      })
      if (playlist) container.bumpLibraryVersion()

      return {
        ...enqueueFresh(items, tagIds, playlist?.id ?? null),
        kind: preview.kind,
        playlistTitle: preview.playlistTitle,
      }
    },
  )
  router.post('/import/share', share)
  router.post('/imports/share', share)

  /**
   * Does yt-dlp see a signed-in YouTube Music session? Liked Music is private,
   * so resolving it proves the cookies work end to end.
   */
  router.post(
    '/import/youtube/test',
    route({}, async (): Promise<YtCookieTest> => {
      const source = container.settings.get().ytCookieSource
      try {
        const probed = await container.ytdlp.probe(YT_LIKED_MUSIC_URL)
        return {
          ok: true,
          source,
          count: probed.tracks.length,
          playlistTitle: probed.playlistTitle,
          error: null,
        }
      } catch (error) {
        return {
          ok: false,
          source,
          count: null,
          playlistTitle: null,
          error: error instanceof Error ? error.message : String(error),
        }
      }
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
