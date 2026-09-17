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

const DownloadEntrySchema = z.object({
  songId: z.number().int().positive(),
  /** File name inside the downloads directory, not a full path. */
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  /** The manifest etag at download time, so a re-encoded file is noticed. */
  etag: z.string(),
  downloadedAt: z.string(),
})
export type DownloadEntry = z.infer<typeof DownloadEntrySchema>

const DownloadIndexSchema = z.object({
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
 * From a server, the id leads: it is unique and stable even when a song is
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

/**
 * Every file this device is keeping, whatever it is for.
 *
 * Including songs the library no longer has: the entries and their files are
 * still there, and this is the number the buttons that act on all of them —
 * "Remove all downloads" — have to be gated on. For "how much of my library is
 * here", which is what a person means, `downloadedFrom` is the one to ask.
 */
export function downloadedCount(index: DownloadIndex): number {
  return Object.keys(index.entries).length
}

/**
 * How many of `songIds` are on this device.
 *
 * The count to show beside a library, because the index outlives the library
 * it was filled from: a song removed, or a whole library replaced, leaves its
 * entry and its file behind until something clears them. Counting entries
 * instead once had the foot of the sidebar reading "45 songs · 66 saved
 * offline", which is not a thing that can be true.
 */
export function downloadedFrom(index: DownloadIndex, songIds: readonly number[]): number {
  let held = 0
  const seen = new Set<number>()
  for (const id of songIds) {
    if (seen.has(id)) continue
    seen.add(id)
    if (isDownloaded(index, id)) held += 1
  }
  return held
}

export function totalBytes(index: DownloadIndex): number {
  return Object.values(index.entries).reduce((sum, entry) => sum + entry.sizeBytes, 0)
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
 * Files this device is keeping that it no longer has a reason to.
 *
 * Two different reasons, kept apart because they read as different things to
 * whoever is being told. A song that *left the library* takes nothing with it
 * — the entry and the file stay behind, and after a library is replaced there
 * can be a great many of them. A song still in the library whose *audio was
 * replaced* since it was downloaded has a file that would simply be fetched
 * again. Both are safe to delete; only the second has "changed" happen to it,
 * and saying it about the first is how the panel once reported 21 files as
 * changed on a server that had never held them.
 */
export interface StaleDownloads {
  /** Entries for songs the library does not have any more. */
  readonly gone: readonly number[]
  /** Entries for songs still here whose audio was replaced since. */
  readonly changed: readonly number[]
  /** Both, in id order: what removing acts on. */
  readonly all: readonly number[]
  /** What removing all of them would give back. */
  readonly bytes: number
}

export function staleDownloads(index: DownloadIndex, manifest: SyncManifest): StaleDownloads {
  const byId = new Map(manifest.entries.map(entry => [entry.id, entry]))
  const gone: number[] = []
  const changed: number[] = []
  let bytes = 0
  for (const entry of Object.values(index.entries)) {
    const current = byId.get(entry.songId)
    if (current === undefined) gone.push(entry.songId)
    else if (current.etag !== entry.etag) changed.push(entry.songId)
    else continue
    bytes += entry.sizeBytes
  }
  const order = (a: number, b: number): number => a - b
  return {
    gone: gone.sort(order),
    changed: changed.sort(order),
    all: [...gone, ...changed].sort(order),
    bytes,
  }
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
