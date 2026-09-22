import type { Song } from '@selfmp3/shared'
import type { ServerConnection } from '../connection/connection.js'
import type { DownloadEntry, DownloadIndex } from '../downloads/downloadIndex.js'

/**
 * Offline storage ports — where a song lives once this device has kept a copy.
 *
 * The browser keeps them in the Cache API, sliced back out by a service worker
 * so a range request still seeks. The phone keeps files on disk beside a JSON
 * index. Neither belongs in this package; this is what the download queue is
 * written against so there is one of it.
 *
 * Deliberately only the storage, not the downloading. The queue is written once,
 * in `downloads/queue.ts`, and a platform supplies only where the bytes go.
 * Ordering, progress, pausing and what to do about a failure are policy, and
 * policy goes in the shared queue above this. What genuinely differs is
 * where the bytes go, and that is all this names.
 */

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
 * Shaped around the queue rather than the library view: an index to read and write, a transfer to begin, and files to
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
  /**
   * Throw away a kept song's file. Settles once it is gone, and rejects when
   * it is not — the queue keeps the song's entry then, so bytes still on the
   * device stay counted and the next remove tries again. A fire-and-forget
   * delete here left orphans: files with no entry, invisible to "Remove all".
   */
  delete(entry: DownloadEntry): Promise<void>
  clear(): Promise<void>
}
