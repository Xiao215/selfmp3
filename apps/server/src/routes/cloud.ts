import { Router } from 'express'
import type { CloudStatus, CloudUids } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * How this server's library stands with its bucket (docs/SYNC.md). Both are
 * reads: a library reaches its bucket through the grant its devices gave the
 * server (`POST /api/hub/join`), and nothing a device sends here repoints it.
 */
export function cloudRoutes(container: Container): Router {
  const router = Router()

  router.get(
    '/cloud',
    route({}, (): CloudStatus => container.cloudSync.status()),
  )

  /**
   * The uid behind each of this server's song ids.
   *
   * A device signed in to the bucket numbers the same songs its own way, so an
   * answer from here — the stats, a metadata lookup — names songs under ids
   * that mean nothing to it. This is how it lines the two up: the uid is the
   * name both libraries know a song by. Rows for songs this server has not
   * uploaded are harmless; the device simply has no song under that uid.
   */
  router.get(
    '/cloud/uids',
    route({}, (): CloudUids => ({
      songs: container.cloudRepo.songFiles().map(song => ({ id: song.id, uid: song.uid })),
    })),
  )

  return router
}
