import { Router } from 'express'
import {
  BulkTagSchema,
  CreateTagSchema,
  RenameTagSchema,
  tagRenameProblem,
  type Affected,
  type Ok,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'
import { ParamsWithId } from '../http/params.js'

export function tagRoutes(container: Container): Router {
  const router = Router()

  /**
   * Creating a tag that already exists returns the existing one rather than
   * failing. Two devices creating "chill" at once should converge on one tag,
   * not surface a conflict the user has to resolve.
   */
  router.post(
    '/tags',
    route({ body: CreateTagSchema }, ({ body }) => {
      const tag = container.tags.create(body.name, body.hue)
      container.bumpLibraryVersion()
      return tag
    }),
  )

  router.patch(
    '/tags/:id',
    route({ params: ParamsWithId, body: RenameTagSchema }, ({ params, body }) => {
      if (!container.tags.byId(params.id)) throw HttpError.notFound('no such tag')

      const clash = tagRenameProblem(container.tags.all(), params.id, body.name)
      if (clash) throw HttpError.refused(clash)

      const updated = container.tags.update(params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.hue !== undefined ? { hue: body.hue } : {}),
      })
      container.edits.tag(params.id, [
        ...(body.name !== undefined ? (['name'] as const) : []),
        ...(body.hue !== undefined ? (['hue'] as const) : []),
      ])
      container.bumpLibraryVersion()
      return updated
    }),
  )

  /**
   * Deleting a tag never touches the songs that carried it; the playlists that
   * follow it let go of it (`TagRemoval`).
   */
  router.delete(
    '/tags/:id',
    route({ params: ParamsWithId }, ({ params }): Ok => {
      if (!container.tags.byId(params.id)) throw HttpError.notFound('no such tag')
      container.tagRemoval.remove(params.id)
      container.bumpLibraryVersion()
      return { ok: true }
    }),
  )

  /** Tag or untag many songs at once — the multi-select path in the UI. */
  router.post(
    '/tags/bulk',
    route({ body: BulkTagSchema }, ({ body }): Affected => {
      if (!container.tags.byId(body.tagId)) throw HttpError.notFound('no such tag')
      // A song removed since the selection was made is skipped, as adding to a
      // playlist skips it, rather than failing the rest on its foreign key.
      const present = container.songs.existingIds(body.songIds)
      const songIds = body.songIds.filter(id => present.has(id))
      const affected = container.tags.bulk(songIds, body.tagId, body.action)
      container.edits.tagOnSongs(body.tagId, songIds)
      container.bumpLibraryVersion()
      return { affected }
    }),
  )

  return router
}
