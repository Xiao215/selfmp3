import fs from 'node:fs'
import { Router } from 'express'
import { z } from 'zod'
import { BooleanQuerySchema, IdSchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { sendRange } from '../http/range.js'

const ParamsWithId = z.object({ id: IdSchema })

/** The sizes covers are kept at; a request is answered with the smallest that is not smaller. */
const ART_SIZES = [160, 320, 640, 1024] as const

function snapArtSize(wanted: number): number {
  return ART_SIZES.find(size => size >= wanted) ?? 1024
}

/**
 * Audio streaming and cover art.
 *
 * These are the only endpoints that move real bytes, so they are also the only
 * ones that care about range requests, caching headers and conditional GETs.
 */
export function mediaRoutes(container: Container): Router {
  const router = Router()

  const stream = route(
    {
      params: ParamsWithId,
      query: z.object({ redirect: BooleanQuerySchema }),
    },
    async ({ params, query, req, res }) => {
      const song = container.songs.byId(params.id)
      if (!song) throw HttpError.notFound(`no song with id ${params.id}`)

      // With object storage, hand the client a presigned URL so the audio
      // comes straight from the CDN instead of through this process. Opt-in,
      // because a redirect breaks the service worker's ability to cache.
      if (query.redirect) {
        const signed = await container.storage.signedUrl(song.path)
        if (signed) {
          res.redirect(302, signed)
          return undefined
        }
      }

      const source = await container.storage.rangeSource(song.path, song.mime)
      if (!source) {
        // The database says it exists but storage disagrees: flag it so the
        // UI can show it as missing rather than silently failing to play.
        container.songs.markMissing(song.path)
        container.bumpLibraryVersion()
        throw HttpError.notFound('the audio file for this song is missing')
      }

      // Somebody is listening right now, which macOS has no way of knowing
      // from an open socket. Held until this response is done however it
      // ends — finished, aborted, or the phone walking out of range.
      const awake = container.keepAwake.hold()
      res.on('close', awake)

      await sendRange(req, res, source)
      return undefined
    },
  )

  router.get('/stream/:id', stream)
  // HEAD lets the service worker check size and etag before committing to a
  // multi-megabyte download during an offline sync.
  router.head('/stream/:id', stream)

  router.get(
    '/art/:id',
    route(
      {
        params: ParamsWithId,
        // `size`: the longest side wanted. Snapped up to one of a few sizes, so
        // a library's thumbnails are a handful of files per cover, not one per
        // pixel value anyone ever asked for.
        query: z.object({ size: z.coerce.number().int().min(16).max(2048).optional() }),
      },
      async ({ params, query, req, res }) => {
        const cover =
          query.size === undefined
            ? container.covers.find(params.id)
            : await container.covers.thumbnail(params.id, snapArtSize(query.size))
        if (!cover) throw HttpError.notFound('no cover art')

        const stat = fs.statSync(cover.path)
        const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`

        const caching = {
          'Content-Type': cover.contentType,
          ETag: etag,
          'Cache-Control': 'private, max-age=604800',
        }

        if (req.headers['if-none-match'] === etag) {
          res.set(caching).status(304).end()
          return undefined
        }

        // Awaited deliberately: sendFile is asynchronous, so returning straight
        // away would let the route wrapper see `headersSent === false` and send
        // a 204 on top of the image.
        //
        // `dotfiles: 'allow'` because the path is the server's own, never the
        // request's, and `send` otherwise answers 404 for any path with a
        // dot-segment in it — so a data directory under `~/.local/share` (the
        // Linux default) or any other hidden folder served no covers at all.
        //
        // The caching headers go through `headers`, which Express sets only once
        // the file is really being sent. Set up front, a send that failed went out
        // with a week's max-age, and the app's cache went on serving itself that
        // failure in place of the cover long after the server had it.
        await new Promise<void>((resolve, reject) => {
          res.sendFile(cover.path, { dotfiles: 'allow', headers: caching }, error =>
            error ? reject(error) : resolve(),
          )
        })
        return undefined
      },
    ),
  )

  return router
}
