import { Router } from 'express'
import { z } from 'zod'
import {
  ApplyMetadataSchema,
  IdSchema,
  SONG_FIELDS,
  type ApplyMetadataResult,
  type FixCoversStatus,
  type MetadataLookupResponse,
  type SongPatch,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithId = z.object({ id: IdSchema })

/**
 * Metadata polish: look a song up on public databases, apply what the user
 * picked, and the library-wide cover-art pass.
 *
 * Corrections go into the database exactly like a manual edit — the audio
 * file is never rewritten, so a rescan cannot undo them and a bad match is
 * one more edit away from fixed.
 */
export function metadataRoutes(container: Container): Router {
  const router = Router()

  const requireSong = (id: number) => {
    const song = container.songs.byId(id)
    if (!song) throw HttpError.notFound(`no song with id ${id}`)
    return song
  }

  router.get(
    '/songs/:id/lookup',
    route({ params: ParamsWithId }, async ({ params }): Promise<MetadataLookupResponse> => {
      const song = requireSong(params.id)
      const candidates = await container.lookup.lookup({
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
      })
      return { candidates }
    }),
  )

  router.post(
    '/songs/:id/apply-metadata',
    route(
      { params: ParamsWithId, body: ApplyMetadataSchema },
      async ({ params, body }): Promise<ApplyMetadataResult> => {
        const song = requireSong(params.id)
        const { artworkUrl, ...fields } = body

        const patch: SongPatch = fields
        if (Object.keys(patch).length > 0) {
          container.songs.patch(song.id, patch)
          container.edits.songs(
            [song.id],
            SONG_FIELDS.filter(field => patch[field] !== undefined),
          )
        }

        let artworkSaved = false
        if (artworkUrl) artworkSaved = await container.covers.saveFromUrl(song.id, artworkUrl)

        container.bumpLibraryVersion()
        return { ok: true, artworkSaved }
      },
    ),
  )

  router.post(
    '/library/fix-covers',
    route({}, (): FixCoversStatus => container.fixCovers.start()),
  )

  router.get(
    '/library/fix-covers',
    route({}, (): FixCoversStatus => container.fixCovers.status()),
  )

  router.post(
    '/library/fix-covers/cancel',
    route({}, (): FixCoversStatus => container.fixCovers.cancel()),
  )

  return router
}
