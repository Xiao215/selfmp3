import { Router } from 'express'
import { z } from 'zod'
import { BulkTagSchema, CreateTagSchema, IdSchema, RenameTagSchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { HttpError } from '../http/errors.js'

const ParamsWithId = z.object({ id: IdSchema })

export function tagRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/tags',
    route({}, () => container.tags.all()),
  )

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

      if (body.name !== undefined) {
        const clash = container.tags.byName(body.name)
        if (clash && clash.id !== params.id) {
          throw HttpError.conflict(`a tag called "${body.name}" already exists`)
        }
      }

      const updated = container.tags.update(params.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.hue !== undefined ? { hue: body.hue } : {}),
      })
      container.bumpLibraryVersion()
      return updated
    }),
  )

  /** Deleting a tag never touches the songs that carried it. */
  router.delete(
    '/tags/:id',
    route({ params: ParamsWithId }, ({ params }) => {
      if (!container.tags.byId(params.id)) throw HttpError.notFound('no such tag')
      container.tags.delete(params.id)
      container.bumpLibraryVersion()
      return { ok: true as const }
    }),
  )

  /** Tag or untag many songs at once — the multi-select path in the UI. */
  router.post(
    '/tags/bulk',
    route({ body: BulkTagSchema }, ({ body }) => {
      if (!container.tags.byId(body.tagId)) throw HttpError.notFound('no such tag')
      const affected = container.tags.bulk(body.songIds, body.tagId, body.action)
      container.bumpLibraryVersion()
      return { affected }
    }),
  )

  return router
}
