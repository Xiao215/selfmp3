import { Router } from 'express'
import {
  CloudConnectSchema,
  CloudSignInCodeSchema,
  CloudSignInSchema,
  type CloudStatus,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { CloudError } from '../bucket/store.js'
import { HttpError } from '../http/errors.js'
import { route } from '../http/route.js'

/**
 * This server's way into the cloud bucket (docs/SYNC.md): sign in with Google
 * through the doorman and connect the bucket that belongs to that account —
 * or, with no doorman, connect a bucket directly with its key. Then: see how
 * publishing is going, publish now, disconnect. A key is accepted here and
 * never sent back, and the doorman's session never leaves this server.
 */
export function cloudRoutes(container: Container): Router {
  const router = Router()

  /** The bucket's own answer is the useful part — it goes back to the form as it is. */
  const explain = async <T>(work: () => Promise<T> | T): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (error instanceof CloudError) {
        throw error.kind === 'auth'
          ? HttpError.unauthorized(error.message)
          : HttpError.unprocessable(error.message)
      }
      throw error
    }
  }

  router.get(
    '/cloud',
    route({}, (): CloudStatus => container.cloudSync.status()),
  )

  /** Connect a bucket directly with its key: the way in when there is no doorman. */
  router.put(
    '/cloud',
    route({ body: CloudConnectSchema }, ({ body }): Promise<CloudStatus> =>
      explain(() => container.cloudSync.connect(body)),
    ),
  )

  router.delete(
    '/cloud',
    route({}, (): CloudStatus => container.cloudSync.disconnect()),
  )

  /**
   * Start waiting for a Google sign-in the browser has just opened with this
   * attempt id. Answers at once; poll GET for the account appearing.
   */
  router.post(
    '/cloud/signin',
    route({ body: CloudSignInSchema }, ({ body }): Promise<CloudStatus> =>
      explain(() => container.cloudSync.beginSignIn(body.attempt)),
    ),
  )

  router.delete(
    '/cloud/signin',
    route({}, (): CloudStatus => container.cloudSync.cancelSignIn()),
  )

  /** The code Google's sign-in ended with, to claim the session with. */
  router.post(
    '/cloud/signin/code',
    route({ body: CloudSignInCodeSchema }, ({ body }): Promise<CloudStatus> =>
      explain(() => container.cloudSync.enterSignInCode(body.code)),
    ),
  )

  /** Connect a bucket to the signed-in Google account, through the doorman. */
  router.put(
    '/cloud/storage',
    route({ body: CloudConnectSchema }, ({ body }): Promise<CloudStatus> =>
      explain(() => container.cloudSync.connectStorage(body)),
    ),
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
