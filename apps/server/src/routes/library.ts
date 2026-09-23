import { Router } from 'express'
import { z } from 'zod'
import {
  SyncManifestQuerySchema,
  type AnalysisStatus,
  type Library,
  type ScanResult,
  type SyncManifest,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'

/**
 * The library answer's `generatedAt`: when this server first answered with
 * the library's current version.
 *
 * Not the time of each request: every refetch — a window regaining focus, a
 * play being counted — would look like a new library to anything that keys on
 * it, and the phone's keep-alongside pass (useKeepAlongside) would walk every
 * song and playlist again for nothing. The version moves on every edit that
 * changes what the library holds; a restart starts the version again, and the
 * first answer after it gets a new time, so two different libraries never
 * share a stamp.
 */
export function answeredAt(
  version: () => number,
  now: () => Date = () => new Date(),
): () => string {
  let last: { version: number; at: string } | null = null
  return () => {
    const current = version()
    if (last?.version !== current) last = { version: current, at: now().toISOString() }
    return last.at
  }
}

/**
 * Library-wide endpoints: the full snapshot, rescanning, and the sync manifest
 * the phone uses to work out what it still needs to download.
 */
export function libraryRoutes(container: Container): Router {
  const router = Router()
  const generatedAt = answeredAt(() => container.libraryVersion())

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
        generatedAt: generatedAt(),
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

  /** Sweep the inbox folder: a file dropped there becomes a song, and is uploaded. */
  router.post(
    '/library/scan',
    route({}, async (): Promise<ScanResult> => {
      const result = await container.scanner.scan()
      if (result.added > 0 || result.updated > 0) container.bumpLibraryVersion()
      void container.lyricsIndex.backfill()
      return result
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
   *
   * `scope=playlists` narrows it to songs that are in at least one playlist,
   * smart ones resolved as they stand now — for a phone told to keep only
   * those. The default is everything.
   */
  router.get(
    '/library/manifest',
    route({ query: SyncManifestQuerySchema }, ({ query }): SyncManifest => {
      let entries = container.songs.manifest()
      if (query.scope === 'playlists') {
        const inPlaylists = new Set<number>()
        for (const playlist of container.playlists.all()) {
          for (const id of container.playlists.songIds(playlist)) inPlaylists.add(id)
        }
        entries = entries.filter(entry => inPlaylists.has(entry.id))
      }
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
