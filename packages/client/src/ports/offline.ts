import type { Song } from '@selfmp3/shared'
import type { ServerConnection } from '../connection/connection.js'
import type { DownloadEntry, DownloadIndex } from '../downloads/downloadIndex.js'

/**
 * `OfflineStore` — where a song lives once this device has kept a copy.
 *
 * The browser keeps them in the Cache API, sliced back out by a service worker
 * so a range request still seeks. The phone keeps files on disk beside a JSON
 * index. Neither belongs in this package; this is what `OfflineProvider` is
 * written against so there is one of it.
 *
 * Deliberately only the storage, not the downloading. The two apps have very
 * different shapes today — the browser's is free functions over the Cache API,
 * the phone's is a stateful `DownloadQueue` with pause, resume and retry — but
 * the difference is not platform, it is that the queue was written twice.
 * Ordering, progress, pausing and what to do about a failure are policy, and
 * policy goes in the shared provider above this. What genuinely differs is
 * where the bytes go, and that is all this names.
 */

/** What this device has spent, and what it is allowed. */
export interface StorageUsage {
  /** Bytes used by kept songs specifically. */
  readonly audioBytes: number
  /** Bytes everything on this origin or in this app is using. */
  readonly usedBytes: number
  /** What the platform is willing to give, where it will say. */
  readonly quotaBytes: number | null
  readonly cachedCount: number
}

/** Fraction of the download done, or null where the size is not known yet. */
export type DownloadFraction = number | null

export interface SaveOptions {
  /**
   * Structural, rather than the DOM's `AbortSignal`, which this package cannot
   * name — the same convention `ClientRequestInit` already uses. Both
   * platforms' real signals satisfy it.
   */
  readonly signal?: unknown
  /** Called as bytes arrive, so a row's progress ring can fill. */
  readonly onProgress?: (fraction: DownloadFraction) => void
}

export interface OfflineStore {
  /**
   * Whether this device can keep songs at all.
   *
   * Not a constant: the Cache API exists only in a secure context, so the same
   * browser build has it at `https://` and not at `http://192.168.1.10:4600`.
   * Everything offline in the UI hangs off this.
   */
  readonly available: boolean

  has(songId: number): Promise<boolean>
  /** Everything kept, for deciding what a whole library view can play. */
  ids(): Promise<Set<number>>
  /** Sizes, so a list can show them without opening each song. */
  bytes(ids: Iterable<number>): Promise<Map<number, number>>

  /** Fetch and keep one song. Resolves to the bytes written. */
  save(songId: number, options?: SaveOptions): Promise<number>
  remove(songId: number): Promise<void>
  clear(): Promise<void>

  usage(): Promise<StorageUsage>

  /**
   * Where the kept copy is, for a player that takes a URL and nothing else.
   *
   * Optional because it is genuinely asymmetric rather than merely unwritten.
   * The phone needs it: track-player is handed a file path and plays it. The
   * browser has nothing to hand back — its service worker intercepts the
   * ordinary stream URL, so the player never knows a copy was involved, which
   * is why the web app plays offline without a line of code about it.
   */
  localUri?(songId: number): string | null

  /**
   * Ask not to be evicted under storage pressure.
   *
   * Optional and best-effort: the browser may refuse or ignore it, and a phone
   * has nothing to ask. A false answer is not an error, it is the platform
   * saying it will decide for itself.
   */
  requestPersistence?(): Promise<boolean>
}

/** How far one transfer has got. `totalBytes` is 0 where the platform does not know yet. */
export interface TransferProgress {
  readonly bytesWritten: number
  readonly totalBytes: number
}

/**
 * One song being fetched, which can be stopped part-way.
 *
 * `run()` resolves with the bytes written, or with null when a pause landed
 * before it finished. It rejects on failure, and when `cancel()` calls it off.
 * Calling `run()` again after a null continues the same transfer — which is the
 * whole reason this is an object rather than a function: the phone's download
 * task holds the platform's resume data, and a paused song picks up where it
 * stopped instead of starting again.
 */
export interface DownloadTransfer {
  run(): Promise<number | null>
  pause(): void
  cancel(): void
}

/**
 * Where kept songs go, as the download queue needs it.
 *
 * Narrower than `OfflineStore` and shaped around the queue rather than the
 * library view: an index to read and write, a transfer to begin, and files to
 * throw away. Ordering, pausing, progress and what a failure means are the
 * queue's (`DownloadQueue`, in `packages/client`), so there is one of each and
 * the platforms differ only in where the bytes land.
 *
 * `resumable` is the one behaviour that genuinely differs. The phone's
 * transfer continues mid-file after a pause. The browser writes a Cache API
 * response whole and has nothing to continue, so its `pause()` lets the song
 * in flight finish and the queue stops after it.
 */
export interface DownloadStorage {
  readonly available: boolean
  readonly resumable: boolean
  /**
   * Where downloads come from — the server or the cloud session — and the songs
   * they belong to. The browser's cache is keyed by stream URL, and a stream
   * URL carries the song's `rev`, so without the song list the storage cannot
   * find, size or delete a song it has kept.
   */
  configure?(connection: ServerConnection | null, songs: readonly Song[]): void
  /** Null when there is no index or it cannot be read; the queue starts empty. */
  readIndex(): Promise<DownloadIndex | null>
  writeIndex(index: DownloadIndex): Promise<void>
  localUri(entry: DownloadEntry): string | null
  /**
   * Start fetching a song, from nothing. Anything already half-written for it
   * is the storage's to clear first. May throw, or return a transfer whose
   * `run()` rejects, when there is nowhere to fetch it from.
   */
  begin(
    song: Song,
    expectedBytes: number,
    onProgress: (progress: TransferProgress) => void,
  ): DownloadTransfer
  /** Throw away what a failed or cancelled transfer left behind for this song. */
  discard(song: Song): void
  delete(entry: DownloadEntry): void
  clear(): Promise<void>
}
