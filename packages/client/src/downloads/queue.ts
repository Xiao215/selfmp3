import type { Song, SyncManifest } from '@selfmp3/shared'

import type { DownloadStorage, DownloadTransfer, TransferProgress } from '../ports/offline.js'
import {
  addEntry,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  pendingIds,
  removeEntry,
  type DownloadIndex,
} from './downloadIndex.js'

type Connection = Parameters<NonNullable<DownloadStorage['setConnection']>>[0]

export interface DownloadQueueState {
  readonly index: DownloadIndex
  /** Ids still to fetch, in order. Includes the one in flight. */
  readonly queue: readonly number[]
  readonly activeSongId: number | null
  readonly bytesWritten: number
  readonly totalBytes: number
  readonly paused: boolean
  /** Last failure, kept until the next attempt so the UI can show it. */
  readonly error: string | null
}

const INITIAL_STATE: DownloadQueueState = {
  index: EMPTY_INDEX,
  queue: [],
  activeSongId: null,
  bytesWritten: 0,
  totalBytes: 0,
  paused: false,
  error: null,
}

/**
 * Keeping songs on this device: one at a time, in order, stoppable.
 *
 * The policy both apps had written separately — the phone's `DownloadQueue`
 * over `expo-file-system` and the browser's over the Cache API — written once,
 * over the `DownloadStorage` port, so the two differ only in where the bytes
 * go. Extracted from the phone's, which is the older and more exercised of the
 * two, behaviour for behaviour, with its tests written first.
 *
 * Two things differ from the phone's copy, and both are bug fixes the tests pin:
 *
 *   - Cancelling a *paused* download used to set the flag that says "the next
 *     rejection is only this cancel". A paused transfer never rejects, so the
 *     flag stayed set, and the next genuine failure — any song, any time later
 *     — was swallowed without a word. The flag is now set only for a transfer
 *     actually in flight.
 *   - Finding the source of a song (a Mac, or the cloud) happened outside the
 *     `try`, so "no server, and not signed in" escaped the loop and stalled the
 *     queue with nothing on screen. Starting a transfer is now inside it, and
 *     that failure is reported like any other.
 */
export class DownloadQueue {
  #state: DownloadQueueState = INITIAL_STATE
  readonly #listeners = new Set<(state: DownloadQueueState) => void>()
  readonly #storage: DownloadStorage
  readonly #now: () => Date

  /** The transfer in flight, or the paused one. Null once a song finishes. */
  #transfer: DownloadTransfer | null = null
  #pausedSongId: number | null = null
  #running = false
  /** Resume tapped while the loop was still waiting for a pause to land. */
  #resumedWhileRunning = false
  /** The next rejection is the cancel that caused it, not a failure to report. */
  #cancelling = false
  #songsById = new Map<number, Song>()
  #manifest: SyncManifest | null = null

  constructor(storage: DownloadStorage, options: { now?: () => Date } = {}) {
    this.#storage = storage
    this.#now = options.now ?? (() => new Date())
  }

  subscribe(listener: (state: DownloadQueueState) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getState(): DownloadQueueState {
    return this.#state
  }

  configure(connection: Connection, songs: readonly Song[]): void {
    this.#storage.setConnection?.(connection)
    this.#songsById = new Map(songs.map(song => [song.id, song]))
  }

  setManifest(manifest: SyncManifest | null): void {
    this.#manifest = manifest
  }

  async load(): Promise<void> {
    if (!this.#storage.available) {
      this.#patch({ index: EMPTY_INDEX })
      return
    }
    let index: DownloadIndex | null = null
    try {
      index = await this.#storage.readIndex()
    } catch {
      // Unreadable index: the audio is still there and will simply be fetched
      // again. Losing the index is annoying, not dangerous.
      index = null
    }
    this.#patch({ index: index ?? EMPTY_INDEX })
  }

  /** Where a kept song is, for a player that takes a URL; null when it is not kept. */
  localUri(songId: number): string | null {
    const entry = entryFor(this.#state.index, songId)
    return entry ? this.#storage.localUri(entry) : null
  }

  enqueue(songIds: readonly number[]): void {
    const fresh = pendingIds(this.#state.index, songIds).filter(
      id => !this.#state.queue.includes(id),
    )
    if (fresh.length === 0) return
    this.#patch({ queue: [...this.#state.queue, ...fresh], error: null })
    void this.#drain()
  }

  pause(): void {
    if (this.#state.paused) return
    this.#patch({ paused: true })
    try {
      this.#transfer?.pause()
    } catch {
      // Already finished or called off; the flag above is what matters.
    }
  }

  resume(): void {
    if (!this.#state.paused) return
    this.#patch({ paused: false })
    // `pause()` returns before the transfer has actually stopped, so a quick
    // Resume arrives while the loop is still waiting on it. That loop is told to
    // carry on once the pause lands, rather than a second loop being started.
    if (this.#running) {
      this.#resumedWhileRunning = true
      return
    }
    void this.#drain()
  }

  cancelAll(): void {
    this.#discardPartial()
    const transfer = this.#transfer
    // Only a transfer in flight rejects when called off. A paused one has
    // already resolved, so marking it would leave the flag set for whatever
    // fails next.
    if (transfer !== null && this.#pausedSongId === null) this.#cancelling = true
    try {
      transfer?.cancel()
    } catch {
      // Already gone; nothing to call off.
    }
    this.#transfer = null
    this.#pausedSongId = null
    this.#resumedWhileRunning = false
    this.#patch({ queue: [], activeSongId: null, bytesWritten: 0, totalBytes: 0, paused: false })
  }

  async remove(songIds: readonly number[]): Promise<void> {
    let index = this.#state.index
    for (const songId of songIds) {
      const entry = entryFor(index, songId)
      if (!entry) continue
      this.#storage.delete(entry)
      index = removeEntry(index, songId)
    }
    await this.#commit(index)
  }

  async removeAll(): Promise<void> {
    this.cancelAll()
    await this.#storage.clear()
    await this.#commit(EMPTY_INDEX)
  }

  // --- the work ------------------------------------------------------------

  async #drain(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      while (!this.#state.paused && this.#state.queue.length > 0) {
        const songId = this.#state.queue[0]
        if (songId === undefined) break
        const finished = await this.#downloadOne(songId)
        // A pause leaves the song at the head of the queue so resuming picks it
        // up again; success and failure both move on.
        if (!finished) break
        this.#patch({ queue: this.#state.queue.filter(id => id !== songId) })
      }
    } finally {
      this.#running = false
      if (this.#state.queue.length === 0) {
        this.#transfer = null
        this.#pausedSongId = null
        this.#patch({ activeSongId: null, bytesWritten: 0, totalBytes: 0 })
      }
    }

    if (this.#resumedWhileRunning) {
      this.#resumedWhileRunning = false
      if (!this.#state.paused && this.#state.queue.length > 0) void this.#drain()
    }
  }

  /** False when the song was paused rather than finished. */
  async #downloadOne(songId: number): Promise<boolean> {
    const song = this.#songsById.get(songId)
    if (!song) {
      this.#patch({ error: `Cannot download song ${songId}: it is not in the library` })
      return true
    }

    const listed = this.#manifest?.entries.find(entry => entry.id === songId)
    const expectedBytes = listed?.sizeBytes ?? song.sizeBytes
    const onProgress = ({ bytesWritten, totalBytes }: TransferProgress): void => {
      this.#patch({ bytesWritten, totalBytes: totalBytes > 0 ? totalBytes : expectedBytes })
    }

    try {
      const paused = this.#transfer
      let transfer: DownloadTransfer
      if (this.#pausedSongId === songId && paused !== null && this.#storage.resumable) {
        // Continue where it stopped; the progress already shown stays true.
        transfer = paused
        this.#patch({ activeSongId: songId, error: null })
      } else {
        this.#patch({
          activeSongId: songId,
          bytesWritten: 0,
          totalBytes: expectedBytes,
          error: null,
        })
        transfer = this.#storage.begin(song, expectedBytes, onProgress)
        this.#transfer = transfer
      }

      const written = await transfer.run()
      if (written === null) {
        this.#pausedSongId = songId
        return false
      }

      this.#pausedSongId = null
      this.#transfer = null
      await this.#commit(
        addEntry(this.#state.index, {
          songId,
          fileName: fileNameFor(song),
          sizeBytes: written,
          etag: listed?.etag ?? '',
          downloadedAt: this.#now().toISOString(),
        }),
      )
      return true
    } catch (error) {
      try {
        this.#storage.discard(song)
      } catch {
        // Nothing half-written to throw away.
      }
      this.#transfer = null
      this.#pausedSongId = null
      // A transfer called off failed because it was called off. Saying so would
      // be reporting the tap back to the person who made it.
      if (this.#cancelling) {
        this.#cancelling = false
        return true
      }
      this.#patch({
        error: `${song.title}: ${error instanceof Error ? error.message : 'download failed'}`,
      })
      return true
    }
  }

  async #commit(index: DownloadIndex): Promise<void> {
    this.#patch({ index })
    try {
      await this.#storage.writeIndex(index)
    } catch (error) {
      this.#patch({
        error: error instanceof Error ? error.message : 'could not save the download index',
      })
    }
  }

  /** Throw away the half-written file of whatever was being fetched, if any. */
  #discardPartial(): void {
    const songId = this.#state.activeSongId
    const song = songId === null ? undefined : this.#songsById.get(songId)
    if (!song) return
    // A song already in the index is a real download, not a partial one.
    if (entryFor(this.#state.index, song.id)) return
    try {
      this.#storage.discard(song)
    } catch {
      // Nothing there.
    }
  }

  #patch(change: Partial<DownloadQueueState>): void {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener(this.#state)
  }
}
