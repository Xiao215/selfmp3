import { Router } from 'express'
import {
  SyncManifestQuerySchema,
  type Library,
  type LibraryVersion,
  type ScanResult,
  type SyncManifest,
} from '@selfmp3/shared'
import type { Container } from '../container.js'
import { route } from '../http/route.js'
import { libraryChanges } from '../repositories/libraryChanges.js'
import { keptByKey } from '../util/keptByKey.js'

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
 * Library-wide endpoints: the full snapshot, rescanning, and the sync manifest
 * the phone uses to work out what it still needs to download.
 */
export function libraryRoutes(container: Container): Router {
  const router = Router()
  const generatedAt = answeredAt(() => container.libraryVersion())
  /*
   * The answer, built and written out once for each state of the library.
   * It is the whole library — 2.5 MB for 5,000 songs — and building it holds
   * the event loop: every tab and device refetches it on each version bump
   * and on focus, and on a busy machine those builds kept /api/health past
   * the app's 3 s "can't reach" (R3-m6).
   *
   * Every row it is read from is in this database, so `libraryChanges` moves
   * with any write, a play or a background pass that bumps no version
   * included. The minute is in the key too: a live playlist of what was
   * played in the last week counts against the clock, and moves with no
   * write at all.
   */
  const changes = libraryChanges(container.db)
  const library = keptByKey(
    () => `${container.libraryVersion()}:${changes()}:${Math.floor(Date.now() / 60_000)}`,
    () => {
      const songs = container.songs.all()
      const answer: Library = {
        songs,
        tags: container.tags.all(),
        playlists: container.playlists.all(),
        ...container.names.joinNames(),
        spellings: container.spellings.current(songs),
        version: container.libraryVersion(),
        generatedAt: generatedAt(),
      }
      return JSON.stringify(answer)
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
      void container.lyricsIndex.backfill()
      return result
    }),
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
