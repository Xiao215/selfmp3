import type { RangeSource } from '../http/range.js'

/**
 * The storage abstraction.
 *
 * Everything that touches an audio file goes through this interface, so the
 * question "where does my music actually live?" has exactly one answer to
 * change. Today it is the local disk; swapping in S3-compatible object storage
 * (Cloudflare R2, Backblaze B2) is a config change plus one driver file, not a
 * refactor of the whole server.
 *
 * Paths are always relative to the storage root and always use forward
 * slashes, so a database written on a Mac stays valid if the library is later
 * moved into a bucket.
 */
export interface StorageDriver {
  readonly name: string

  /** True when the object exists. */
  exists(key: string): Promise<boolean>

  stat(key: string): Promise<StorageStat | null>

  /** List every audio-like object under the root, as relative keys. */
  list(): Promise<string[]>

  read(key: string): Promise<Buffer>

  write(key: string, data: Buffer | NodeJS.ReadableStream): Promise<void>

  delete(key: string): Promise<void>

  /**
   * A range-capable source for streaming. Returning null means the object is
   * gone, which the caller turns into a 404.
   */
  rangeSource(key: string, mime: string): Promise<RangeSource | null>

  /**
   * An absolute local path, when one exists. Only used by tools that must
   * touch the real filesystem — ffprobe, and reading embedded tags. Object
   * storage returns null and those code paths fall back to downloading first.
   */
  localPath(key: string): string | null
}

export interface StorageStat {
  readonly sizeBytes: number
  readonly modifiedAt: Date
  /** Stable across reads, changes when the content changes. */
  readonly etag: string
}

/**
 * A file's ETag from its size and modification time: a new file under the
 * same name is a new tag. The one formula for every file this server sends —
 * the audio, a stored image, the sync manifest's entries — so a tag one of
 * them hands out is the tag the other would.
 */
export function fileEtag(sizeBytes: number, mtimeMs: number): string {
  return `"${sizeBytes.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`
}

/** Normalise a key: forward slashes, no leading slash, no `..` traversal. */
export function normalizeKey(key: string): string {
  const normalized = key
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(segment => segment !== '' && segment !== '.' && segment !== '..')
    .join('/')
  if (normalized === '') throw new Error(`invalid storage key: ${JSON.stringify(key)}`)
  return normalized
}
