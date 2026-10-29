import { Router } from 'express'
import type { SoundMap } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * The sound map (docs/features/sound-map.md): every heard song's place, as a
 * device in a cloud library reads it from the bucket's file. Asking also
 * starts a fold when the vectors have changed since the last map, for a
 * server with no bucket passes to start one.
 */
export function soundMapRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/sound-map',
    route({}, (): SoundMap => {
      void container.soundMap.refresh()
      return container.soundMap.forLibrary()
    }),
  )

  return router
}
