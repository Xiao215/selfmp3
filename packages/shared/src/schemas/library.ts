import { z } from 'zod'
import { IdSchema } from './common.js'
import { SongSchema } from './song.js'
import { TagSchema } from './tag.js'
import { PlaylistSchema } from './playlist.js'

/**
 * The whole library in one response.
 *
 * A personal library is small — a few thousand songs at most — so sending it
 * all at once is both simpler and faster than paginating: the client filters,
 * sorts and searches locally with no round trip, and the phone can mirror the
 * entire payload into IndexedDB for offline use.
 */
export const LibrarySchema = z.object({
  songs: z.array(SongSchema),
  tags: z.array(TagSchema),
  playlists: z.array(PlaylistSchema),
  /** Bumped whenever anything changes, so clients can skip redundant work. */
  version: z.number().int().nonnegative(),
  generatedAt: z.string(),
})
export type Library = z.infer<typeof LibrarySchema>

export const ScanResultSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
})
export type ScanResult = z.infer<typeof ScanResultSchema>

/** Resolved contents of a playlist, in order. */
export const PlaylistSongsSchema = z.object({
  playlistId: IdSchema,
  songIds: z.array(IdSchema),
})
export type PlaylistSongs = z.infer<typeof PlaylistSongsSchema>

/** Small payload the phone polls to decide whether a full sync is needed. */
export const SyncManifestSchema = z.object({
  version: z.number().int().nonnegative(),
  songCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  entries: z.array(
    z.object({
      id: IdSchema,
      sizeBytes: z.number().int().nonnegative(),
      /** Changes when the underlying file changes, so caches can invalidate. */
      etag: z.string(),
    }),
  ),
})
export type SyncManifest = z.infer<typeof SyncManifestSchema>

/**
 * Which songs a device keeps offline: the whole library, or only songs that
 * are in at least one playlist. Chosen per device — a phone short on space and
 * a laptop with plenty can differ.
 */
export const OfflineScopeSchema = z.enum(['library', 'playlists'])
export type OfflineScope = z.infer<typeof OfflineScopeSchema>

export const SyncManifestQuerySchema = z.object({
  scope: OfflineScopeSchema.default('library'),
})

/** Nearest neighbours of one song, closest first. */
export const SimilarSongsSchema = z.object({
  songId: IdSchema,
  songs: z.array(SongSchema),
})
export type SimilarSongs = z.infer<typeof SimilarSongsSchema>

/**
 * What `/api/health` says.
 *
 * The route answers without a token, so that a monitor, launchd or a container
 * healthcheck does not need the secret. That means anything it says is said to
 * anyone who can reach the port — so what describes the library rather than
 * the service is left out unless the asker has authenticated, or there is no
 * token set and so nothing being kept from anyone.
 */
export const HealthSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  storageDriver: z.string(),
  libraryPath: z.string().optional(),
  songCount: z.number().int().nonnegative().optional(),
})
export type Health = z.infer<typeof HealthSchema>
