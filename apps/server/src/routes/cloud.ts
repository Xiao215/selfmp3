import { Router } from 'express'
import { CloudConnectSchema, type CloudStatus } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { CloudError } from '../cloud/store.js'
import { HttpError } from '../http/errors.js'
import { route } from '../http/route.js'

/**
 * This Mac's connection to the cloud bucket (docs/SYNC.md): connect, see how
 * publishing is going, publish now, disconnect. The key is accepted here and
 * never sent back.
 */
export function cloudRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/cloud',
    route({}, (): CloudStatus => container.cloudSync.status()),
  )

  router.put(
    '/cloud',
    route({ body: CloudConnectSchema }, async ({ body }): Promise<CloudStatus> => {
      try {
        return await container.cloudSync.connect(body)
      } catch (error) {
        // The bucket's answer is the useful part: which of the key, the address
        // or the bucket was wrong. It goes back to the form as it is.
        if (error instanceof CloudError) throw HttpError.unprocessable(error.message)
        throw error
      }
    }),
  )

  router.delete(
    '/cloud',
    route({}, (): CloudStatus => container.cloudSync.disconnect()),
  )

  /**
   * Publish now rather than after the next change, checking first what the
   * bucket really holds. Answers at once; poll GET for progress.
   */
  router.post(
    '/cloud/sync',
    route({}, (): CloudStatus => {
      if (!container.cloudSync.connected) throw HttpError.conflict('not connected to a bucket')
      void container.cloudSync.syncNow({ verify: true })
      return container.cloudSync.status()
    }),
  )

  return router
}
