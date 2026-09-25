import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { z } from 'zod'
import {
  AlreadyHaveRequestSchema,
  BooleanQuerySchema,
  isYouTubeUrl,
  ImportEnqueueSchema,
  ImportPreviewRequestSchema,
  ImportShareRequestSchema,
  YT_LIKED_MUSIC_URL,
  type AlreadyHaveResponse,
  type ImportCoverTone,
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
import {
  buildImportPreview,
  have,
  inQueue,
  resolveImportPlaylist,
  waitingToUpload,
} from '../services/importPreview.js'
import { alreadyHave, normaliseUrl, sourceUrlIndex } from '../services/alreadyHave.js'
import { isCoverUrl } from '../services/previewCoverTone.js'

const ParamsWithJobId = z.object({ id: z.string().uuid() })
const ListenQuery = z.object({ url: z.string().url().max(2_000) })

/** How many of a review's rows have their stream looked up before anyone taps (services/listen.ts). */
const WARMED_ROWS = 3
const CoverToneQuery = z.object({ url: z.string().url().max(2_000) })

/** What a range response from YouTube has to say that the browser needs to hear. */
const FORWARDED_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

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
    route({ query: z.object({ refresh: BooleanQuerySchema }) }, async ({ query }) =>
      container.ytdlp.status(query.refresh),
    ),
  )

  /**
   * Queue what is not already queued *and* not already downloaded.
   *
   * The queue check alone only stopped a double tap. A link imported last
   * month was long gone from `import_jobs`, so pasting it again downloaded the
   * whole song a second time and left two files on disk under the same name
   * with a `(2)` after it — which is how a dev library came to hold 111 files
   * of 45 songs.
   *
   * By the video's id, not the link: the same song arrives as
   * `youtube.com/watch?v=…` one day and `youtu.be/…` the next, and both have
   * to be recognised. The preview already greys these out; this is the floor
   * under it, for the share endpoint and for anyone who ticks one anyway.
   */
  const enqueueFresh = (
    items: readonly ImportEnqueueItem[],
    tagIds: readonly number[],
    playlistId: number | null,
  ): ImportEnqueueResult => {
    const downloaded = new Set(
      container.songs
        .withSourceUrls()
        .map(song => normaliseUrl(song.sourceUrl))
        .filter((url): url is string => url !== null),
    )
    const fresh = items.filter(item => {
      if (container.imports.isPending(item.url)) return false
      const url = normaliseUrl(item.url)
      return !(url && downloaded.has(url))
    })
    if (fresh.length === 0) {
      throw HttpError.conflict('those tracks are already in your library or in the queue')
    }
    const jobs = container.imports.enqueue(fresh, tagIds, playlistId)
    container.importQueue.kick()
    return { jobs, skipped: items.length - fresh.length, playlistId }
  }

  router.post(
    '/import/preview',
    route({ body: ImportPreviewRequestSchema }, async ({ body }): Promise<ImportPreview> => {
      const preview = await buildImportPreview(container, body.url)
      // The rows about to be shown, minus the ones already in the library,
      // which say "In library" rather than offering a listen.
      container.listen.warm(
        preview.items
          .filter(item => !item.alreadyHave)
          .slice(0, WARMED_ROWS)
          .map(item => item.url),
      )
      return preview
    }),
  )

  /**
   * The preview's "Yours already", asked again without asking YouTube again.
   *
   * A review is kept on the device across reloads (the app's import draft),
   * so the answer it carries is from whenever the link was looked up. A song
   * removed since — or imported since — has to change it, and this is the
   * same rule the preview applied, over the library as it is now.
   */
  router.post(
    '/import/already-have',
    route({ body: AlreadyHaveRequestSchema }, ({ body }): AlreadyHaveResponse => {
      const library = container.songs.all()
      const knownLinks = sourceUrlIndex(library)
      const waiting = waitingToUpload(container)
      const queued = inQueue(container)
      const answers = body.tracks.map(track =>
        have(alreadyHave(track, library, knownLinks), waiting),
      )
      return {
        have: answers.map(answer => answer.alreadyHave),
        waiting: answers.map(answer => answer.waitingToUpload),
        queued: body.tracks.map(track => queued(track.url)),
      }
    }),
  )

  /**
   * The colour of a review song's cover, for the row playing it
   * (services/previewCoverTone.ts). Only a cover from YouTube's picture hosts
   * is fetched: a link anywhere else is refused before anything is asked.
   */
  router.get(
    '/import/cover-tone',
    route({ query: CoverToneQuery }, async ({ query }): Promise<ImportCoverTone> => {
      if (!isCoverUrl(query.url))
        throw HttpError.badRequest('only a cover from YouTube can be read')
      return { tone: await container.previewCoverTones.tone(query.url) }
    }),
  )

  /**
   * Listen to a track before importing it (services/listen.ts). Range
   * requests go straight through, so the player can seek anywhere, and a
   * link YouTube has stopped honouring is looked up again once.
   */
  router.get(
    '/import/listen',
    route({ query: ListenQuery }, async ({ query, req, res }) => {
      if (!isYouTubeUrl(query.url)) throw HttpError.badRequest('only YouTube links can be played')

      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })

      // YouTube paces a request that asks for the whole file to about the
      // speed the song plays at, and serves a range — any range, even one
      // that runs to the end — at full speed. Players always ask for one; a
      // client that did not is asked for on its behalf, and answered as it
      // asked, whole.
      const asked = req.headers.range
      const open = async (): Promise<Response> => {
        const source = await container.listen.source(query.url).catch((error: unknown) => {
          throw HttpError.unprocessable(error instanceof Error ? error.message : String(error))
        })
        return fetch(source, {
          headers: { Range: asked ?? 'bytes=0-' },
          signal: controller.signal,
        })
      }

      let upstream: Response
      try {
        upstream = await open()
        if (upstream.status === 403 || upstream.status === 410) {
          container.listen.forget(query.url)
          upstream = await open()
        }
      } catch (error) {
        // Gone before YouTube answered: a seek, or another track picked.
        if (controller.signal.aborted) return undefined
        throw error
      }
      if (!upstream.ok) {
        throw HttpError.unprocessable(`YouTube would not play this one (${upstream.status})`)
      }

      const whole = asked === undefined && upstream.status === 206
      res.status(whole ? 200 : upstream.status)
      for (const name of FORWARDED_HEADERS) {
        if (whole && name === 'content-range') continue
        const value = upstream.headers.get(name)
        if (value) res.setHeader(name, value)
      }
      res.setHeader('Cache-Control', 'no-store')
      if (!upstream.body) {
        res.end()
        return undefined
      }

      // A seek closes this response half-way; that is the listener moving on,
      // not a failure worth reporting.
      await pipeline(Readable.fromWeb(upstream.body), res).catch(() => {
        controller.abort()
      })
      return undefined
    }),
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

  /** The queue: every open job, and the newest `limit` finished ones with a count of them all. */
  router.get(
    '/import/queue',
    route(
      { query: z.object({ limit: z.coerce.number().int().min(0).max(500).default(100) }) },
      ({ query }): ImportQueue => {
        const counts = container.imports.counts()
        return {
          jobs: container.imports.recent(query.limit),
          active: counts.running,
          queued: counts.queued,
          done: counts.done,
          pacing: (({ waitMs, pausedUntil, ratchet }) => ({ waitMs, pausedUntil, ratchet }))(
            container.throttle.status(),
          ),
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
        throw HttpError.conflict('that job is already adding its song, or has finished')
      }
      return { ok: true as const }
    }),
  )

  /** Remove: off the queue for good, stopped first if it was downloading. */
  router.delete(
    '/import/jobs/:id',
    route({ params: ParamsWithJobId }, ({ params }) => {
      if (!container.importQueue.remove(params.id)) {
        throw HttpError.conflict('that job is already adding its song, or is gone')
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

  /**
   * The whole queue at once. Pause all calls off everything that can still be
   * called off; Resume all queues everything that was cancelled again, and
   * leaves what failed on its own to its own Retry.
   */
  router.post(
    '/import/pause',
    route({}, () => ({ paused: container.importQueue.pause() })),
  )

  router.post(
    '/import/resume',
    route({}, () => ({ resumed: container.importQueue.resume() })),
  )

  /** Clear: the finished jobs, and only those — what failed or was paused keeps its row. */
  router.post(
    '/import/clear',
    route({}, () => ({ cleared: container.imports.clearFinished() })),
  )

  return router
}
