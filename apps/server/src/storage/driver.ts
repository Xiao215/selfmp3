import type { RangeSource } from '../http/range.js'

/**
 * The library folder on this disk, as the server reaches it.
 *
 * Everything that touches an audio file in the folder goes through this
 * interface. The folder is an inbox, not the library (docs/SYNC.md): an import
 * lands here until it is in the bucket. The bucket itself is reached through
 * `bucket/store.ts`, not this.
 *
 * Paths are always relative to the folder and always use forward slashes, so
 * a key reads the same on every machine.
 */
export interface StorageDriver {
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
   * The absolute path of a key, for tools that must touch the real
   * filesystem — ffmpeg, and reading embedded tags.
   */
  localPath(key: string): string
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
