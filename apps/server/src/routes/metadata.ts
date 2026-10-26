import { Router } from 'express'
import {
  ApplyMetadataSchema,
  SONG_FIELDS,
  type ApplyMetadataResult,
  type MetadataLookupResponse,
  type Ok,
  type SongPatch,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { ParamsWithId, requireSong } from '../http/params.js'

/**
 * Metadata polish: look a song up on public databases, and apply what the
 * user picked.
 *
 * Corrections go into the database exactly like a manual edit — the audio
 * file is never rewritten, so a rescan cannot undo them and a bad match is
 * one more edit away from fixed.
 */
export function metadataRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/songs/:id/lookup',
    route({ params: ParamsWithId }, async ({ params }): Promise<MetadataLookupResponse> => {
      const song = requireSong(container.songs, params.id)
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
        const song = requireSong(container.songs, params.id)
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

  // A cover taken off again: the Undo of one Tidy up filled in, where the
  // song had none before (docs/features/ai.md, "Filling in what's missing").
  router.delete(
    '/songs/:id/cover',
    route({ params: ParamsWithId }, async ({ params }): Promise<Ok> => {
      const song = requireSong(container.songs, params.id)
      await container.covers.remove(song.id)
      container.bumpLibraryVersion()
      return { ok: true }
    }),
  )

  return router
}
