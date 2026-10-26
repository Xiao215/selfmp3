import { Router } from 'express'
import { z } from 'zod'
import {
  SyncManifestQuerySchema,
  type AnalysisStatus,
  type Library,
  type LibraryVersion,
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
 * changes what the library holds, and starts each boot from the clock, so the
 * first answer after a restart gets a new time and two different libraries
 * never share a stamp.
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
 * An answer built and written out once for each `key`, and handed out as
 * written until the key moves.
 *
 * The library is the whole of it — 2.5 MB for 5,000 songs — and building it
 * holds the event loop: every tab and device refetches it on each version
 * bump and on focus, and on a busy machine those builds kept /api/health
 * past the app's 3 s "can't reach" (R3-m6). The key is what the answer is
 * made from, so a kept one is not stale.
 */
function keptAnswer(key: () => string, build: () => unknown): () => string {
  let kept: { key: string; body: string } | null = null
  return () => {
    const current = key()
    if (kept?.key !== current) kept = { key: current, body: JSON.stringify(build()) }
    return kept.body
  }
}

/**
 * Library-wide endpoints: the full snapshot, rescanning, and the sync manifest
 * the phone uses to work out what it still needs to download.
 */
export function libraryRoutes(container: Container): Router {
  const router = Router()
  const generatedAt = answeredAt(() => container.libraryVersion())
  /*
   * Every row the library answer is read from is in this database, and this
   * connection is its only writer: its count of changed rows moves with any
   * write, a play or a background pass that bumps no version included. The
   * minute is in the key too: a live playlist of what was played in the last
   * week counts against the clock, and moves with no write at all.
   */
  const changedRows = container.db.prepare('SELECT total_changes()').pluck()
  const library = keptAnswer(
    () =>
      `${container.libraryVersion()}:${String(changedRows.get())}:${Math.floor(Date.now() / 60_000)}`,
    (): Library => {
      const songs = container.songs.all()
      return {
        songs,
        tags: container.tags.all(),
        playlists: container.playlists.all(),
        ...container.names.joinNames(),
        spellings: container.spellings.current(songs),
        version: container.libraryVersion(),
        generatedAt: generatedAt(),
      }
    },
  )

  /**
   * The whole library in one payload.
   *
   * A personal library is small enough that this is faster than paginating,
   * and it lets the client filter, sort and search with zero round trips —
   * which is exactly what the offline mirror needs anyway.
   */
  router.get(
    '/library',
    route({}, ({ res }) => {
      res.type('json').send(library())
    }),
  )

  /** Cheap poll: has anything changed since the client's last fetch? */
  router.get(
    '/library/version',
    route({}, (): LibraryVersion => ({
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
        const inPlaylists = container.playlists.everySongId()
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

  return router
}
