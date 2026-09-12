import { z } from 'zod'
import type { Song, SyncManifest } from '@selfmp3/shared'

/**
 * The record of what is on this phone.
 *
 * This is a JSON file rather than a SQLite table, deliberately. The index is
 * one small object — a few thousand entries at the very top end, well under a
 * megabyte — that is read once at launch and written after each download. A
 * database would buy indexed queries nobody needs and add a native module,
 * a migration story and a second source of truth about the same folder. A
 * JSON file can also be printed, diffed and deleted by hand when something
 * goes wrong, which for a personal app is worth more than query planning.
 *
 * Everything here is pure so it can be tested without a filesystem; the
 * effectful half lives in `downloads.ts`.
 */

export const DownloadEntrySchema = z.object({
  songId: z.number().int().positive(),
  /** File name inside the downloads directory, not a full path. */
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  /** The manifest etag at download time, so a re-encoded file is noticed. */
  etag: z.string(),
  downloadedAt: z.string(),
})
export type DownloadEntry = z.infer<typeof DownloadEntrySchema>

export const DownloadIndexSchema = z.object({
  /** Bumped if the on-disk shape ever changes. */
  version: z.literal(1).default(1),
  entries: z.record(z.string(), DownloadEntrySchema).default({}),
})
export type DownloadIndex = z.infer<typeof DownloadIndexSchema>

export const EMPTY_INDEX: DownloadIndex = { version: 1, entries: {} }

/**
 * Read an index back, falling back to an empty one.
 *
 * A corrupt index must never stop the app opening: the audio files are still
 * on disk and the worst case is re-downloading them.
 */
export function parseIndex(raw: unknown): DownloadIndex {
  const parsed = DownloadIndexSchema.safeParse(raw)
  return parsed.success ? parsed.data : EMPTY_INDEX
}

/**
 * The file name a song is stored under.
 *
 * From a Mac, the id leads: it is unique and stable even when a song is
 * renamed. From the bucket, the hash of the audio's own bytes leads instead,
 * because a song's id there is handed out by this device and starts again
 * after a sign-out — a file named `7.m4a` would then belong to whichever song
 * became song 7 next, which is the right audio under the wrong name, and it
 * plays. The hash cannot be wrong in that way, and it is already the file's
 * name in the bucket.
 *
 * The extension is kept either way: the player picks its decoder from it.
 */
export function fileNameFor(song: Pick<Song, 'id' | 'path'>): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(song.path)
  const extension = match?.[1]?.toLowerCase() ?? 'mp3'

  const fromBucket = /^audio\/([0-9a-f]{64})\./i.exec(song.path)
  if (fromBucket) return `${fromBucket[1]?.toLowerCase() ?? ''}.${extension}`

  return `${song.id}.${extension}`
}

export function entryFor(index: DownloadIndex, songId: number): DownloadEntry | null {
  return index.entries[String(songId)] ?? null
}

export function isDownloaded(index: DownloadIndex, songId: number): boolean {
  return entryFor(index, songId) !== null
}

export function addEntry(index: DownloadIndex, entry: DownloadEntry): DownloadIndex {
  return { ...index, entries: { ...index.entries, [String(entry.songId)]: entry } }
}

export function removeEntry(index: DownloadIndex, songId: number): DownloadIndex {
  const key = String(songId)
  if (!(key in index.entries)) return index
  const entries = { ...index.entries }
  delete entries[key]
  return { ...index, entries }
}

export function downloadedCount(index: DownloadIndex): number {
  return Object.keys(index.entries).length
}

export function totalBytes(index: DownloadIndex): number {
  return Object.values(index.entries).reduce((sum, entry) => sum + entry.sizeBytes, 0)
}

export function downloadedIds(index: DownloadIndex): number[] {
  return Object.values(index.entries)
    .map(entry => entry.songId)
    .sort((a, b) => a - b)
}

/**
 * Of `songIds`, the ones not on disk yet — in the order asked for, so
 * "download this playlist" fetches it in playlist order and the first tracks
 * are usable first.
 */
export function pendingIds(index: DownloadIndex, songIds: readonly number[]): number[] {
  const seen = new Set<number>()
  const pending: number[] = []
  for (const id of songIds) {
    if (seen.has(id) || isDownloaded(index, id)) continue
    seen.add(id)
    pending.push(id)
  }
  return pending
}

/**
 * Entries the manifest says are out of date, plus entries for songs the
 * library no longer has. Both are safe to delete: the first will be fetched
 * again, the second is a file for a song that no longer exists.
 */
export function staleIds(index: DownloadIndex, manifest: SyncManifest): number[] {
  const byId = new Map(manifest.entries.map(entry => [entry.id, entry]))
  const stale: number[] = []
  for (const entry of Object.values(index.entries)) {
    const current = byId.get(entry.songId)
    if (!current || current.etag !== entry.etag) stale.push(entry.songId)
  }
  return stale.sort((a, b) => a - b)
}

/** Bytes the given songs would add, for the "this will use N MB" line. */
export function bytesToDownload(
  index: DownloadIndex,
  manifest: SyncManifest,
  songIds: readonly number[],
): number {
  const byId = new Map(manifest.entries.map(entry => [entry.id, entry]))
  return pendingIds(index, songIds).reduce((sum, id) => sum + (byId.get(id)?.sizeBytes ?? 0), 0)
}
