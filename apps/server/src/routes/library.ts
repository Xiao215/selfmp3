import { Router } from 'express'
import { z } from 'zod'
import type { AnalysisStatus, Library, ScanResult, SyncManifest } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * Library-wide endpoints: the full snapshot, rescanning, and the sync manifest
 * the phone uses to work out what it still needs to download.
 */
export function libraryRoutes(container: Container): Router {
  const router = Router()

  /**
   * The whole library in one payload.
   *
   * A personal library is small enough that this is faster than paginating,
   * and it lets the client filter, sort and search with zero round trips —
   * which is exactly what the offline mirror needs anyway.
   */
  router.get(
    '/library',
    route({}, (): Library => {
      return {
        songs: container.songs.all(),
        tags: container.tags.all(),
        playlists: container.playlists.all(),
        version: container.libraryVersion(),
        generatedAt: new Date().toISOString(),
      }
    }),
  )

  /** Cheap poll: has anything changed since the client's last fetch? */
  router.get(
    '/library/version',
    route({}, () => ({
      version: container.libraryVersion(),
      songCount: container.songs.count(),
    })),
  )

  router.post(
    '/library/scan',
    route({}, async (): Promise<ScanResult> => {
      const result = await container.scanner.scan()
      if (result.added > 0 || result.updated > 0 || result.removed > 0) {
        container.bumpLibraryVersion()
      }
      return result
    }),
  )

  /** Permanently forget songs whose files are gone. Explicit on purpose. */
  router.post(
    '/library/purge-missing',
    route({}, async () => {
      const purged = await container.scanner.purgeMissing()
      if (purged > 0) container.bumpLibraryVersion()
      return { purged }
    }),
  )

  /**
   * Audio analysis: start (or resume) analysing whatever is missing features.
   *
   * `force` throws existing results away first. The work happens in the
   * background; poll the GET for progress.
   */
  router.post(
    '/library/analyze',
    route(
      { body: z.object({ force: z.boolean().default(false) }).default({}) },
      ({ body }): AnalysisStatus => container.analysis.start(body.force),
    ),
  )

  router.get(
    '/library/analyze',
    route({}, (): AnalysisStatus => container.analysis.status()),
  )

  /**
   * What the phone needs to cache, and how big it is.
   *
   * The etag per entry lets the service worker skip files it already holds and
   * re-download only ones whose underlying file actually changed.
   */
  router.get(
    '/library/manifest',
    route({}, (): SyncManifest => {
      const entries = container.songs.manifest()
      return {
        version: container.libraryVersion(),
        songCount: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        entries,
      }
    }),
  )

  /** Server-side full-text search, for when the client is not holding the library. */
  router.get(
    '/search',
    route(
      {
        query: z.object({
          q: z.string().trim().max(200).default(''),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
      ({ query }) => ({ songs: container.songs.search(query.q, query.limit) }),
    ),
  )

  return router
}
