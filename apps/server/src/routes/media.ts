import fs from 'node:fs'
import { Router } from 'express'
import { z } from 'zod'
import { BooleanQuerySchema, IdSchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { sendRange } from '../http/range.js'

const ParamsWithId = z.object({ id: IdSchema })

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
    route({ params: ParamsWithId }, async ({ params, req, res }) => {
      const cover = container.covers.find(params.id)
      if (!cover) throw HttpError.notFound('no cover art')

      const stat = fs.statSync(cover.path)
      const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`

      res.setHeader('Content-Type', cover.contentType)
      res.setHeader('ETag', etag)
      res.setHeader('Cache-Control', 'private, max-age=604800')

      if (req.headers['if-none-match'] === etag) {
        res.status(304).end()
        return undefined
      }

      // Awaited deliberately: sendFile is asynchronous, so returning straight
      // away would let the route wrapper see `headersSent === false` and send
      // a 204 on top of the image.
      await new Promise<void>((resolve, reject) => {
        res.sendFile(cover.path, error => (error ? reject(error) : resolve()))
      })
      return undefined
    }),
  )

  return router
}
