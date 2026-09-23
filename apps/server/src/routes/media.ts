import { Router } from 'express'
import { z } from 'zod'
import { BooleanQuerySchema, IdSchema, fromSqliteTime, type Song } from '@selfmp3/shared'
import type { CloudStore } from '../bucket/store.js'
import type { Container } from '../container.js'
import type { CloudSongState } from '../repositories/cloud.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { sendRange, type RangeSource } from '../http/range.js'
import { sendStoredImage } from '../http/sendStoredImage.js'

const ParamsWithId = z.object({ id: IdSchema })

/** The sizes covers are kept at; a request is answered with the smallest that is not smaller. */
const ART_SIZES = [160, 320, 640, 1024] as const

function snapArtSize(wanted: number): number {
  return ART_SIZES.find(size => size >= wanted) ?? 1024
}

/**
 * A song's audio as the bucket holds it, a range at a time.
 *
 * The copy on this disk is let go once a song is wholly in the bucket
 * (services/cloudSync.ts), so for most of a library this is the source: each
 * range the player asks for is asked of the bucket in turn, and nothing is
 * kept on the way past. The bucket names the file by its hash, which is as
 * good an etag as there is.
 */
function bucketSource(store: CloudStore, song: Song, state: CloudSongState): RangeSource {
  return {
    sizeBytes: state.audioSize,
    mime: song.mime,
    etag: `"${state.audioKey.replace(/^audio\//, '').replace(/\.[^.]+$/, '')}"`,
    lastModified: new Date(fromSqliteTime(state.uploadedAt)),
    open: async (start, end, signal) => {
      const body = await store.range(state.audioKey, start, end, signal)
      if (!body) throw new Error('the bucket has no such file')
      return body
    },
  }
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

      // A copy still here — an import not yet uploaded, or not yet analysed —
      // is served from here; otherwise the bucket is where the song is.
      let source = await container.storage.rangeSource(song.path, song.mime)
      if (!source) {
        const store = container.cloudSync.bucket()
        const state = container.cloudRepo.state(song.id)
        if (!store || !state) {
          throw HttpError.notFound('this song’s audio is not in the bucket yet')
        }
        source = bucketSource(store, song, state)
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
        await sendStoredImage(req, res, cover)
        return undefined
      },
    ),
  )

  return router
}
