import type { Song, SyncManifest } from '@selfmp3/shared'

import type { DownloadStorage, DownloadTransfer, TransferProgress } from '../ports/offline.js'
import {
  entryIsCurrent,
  addEntry,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  pendingIds,
  removeEntry,
  type DownloadIndex,
} from './downloadIndex.js'
import { createThrottle, type Throttle } from './throttle.js'

/**
 * How often byte progress alone reaches listeners: four times a second. See
 * `throttle.ts`; anything else about the queue is told at once.
 */
export const PROGRESS_INTERVAL_MS = 250

/** Waits before trying a failed song again: twice, and then it has failed. */
const RETRY_DELAYS_MS = [2_000, 10_000]

type Connection = Parameters<NonNullable<DownloadStorage['configure']>>[0]

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
 * One policy, written once over the `DownloadStorage` port so it behaves the
 * same whether the underlying storage is the phone's `expo-file-system` or the
 * browser's Cache API — the two differ only in where the bytes go.
 *
 * Two subtleties, both pinned by tests:
 *
 *   - The flag that says "the next rejection is only this cancel" is set only
 *     for a transfer actually in flight. Set it when cancelling a *paused*
 *     download and it stays set — a paused transfer never rejects — and the
 *     next genuine failure, any song, any time later, is swallowed.
 *   - Finding the source of a song (a server, or the cloud) happens inside the
 *     `try`. Outside it, "no server, and not signed in" escapes the loop and
 *     stalls the queue with nothing on screen.
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
  /**
   * Byte progress, told at most four times a second. `getState()` is always
   * current; only the telling is skipped.
   */
  readonly #progressNotice: Throttle
  readonly #retryDelaysMs: readonly number[]
  readonly #wait: (ms: number) => Promise<void>
  /** Failed attempts so far at the song in flight. */
  #failures = 0

  constructor(
    storage: DownloadStorage,
    options: {
      now?: () => Date
      /** Milliseconds, for pacing progress; a test's own clock. */
      nowMs?: () => number
      /** How long to wait before each retry of a failed song; its length is how many. */
      retryDelaysMs?: readonly number[]
      /**
       * How to wait before a retry. This package compiles with no timers (see
       * throttle.ts), so the app brings one; without it a failure is final at once.
       */
      wait?: (ms: number) => Promise<void>
    } = {},
  ) {
    this.#storage = storage
    this.#now = options.now ?? (() => new Date())
    this.#retryDelaysMs = options.wait ? (options.retryDelaysMs ?? RETRY_DELAYS_MS) : []
    this.#wait = options.wait ?? (() => Promise.resolve())
    this.#progressNotice = createThrottle(() => this.#notify(), PROGRESS_INTERVAL_MS, options.nowMs)
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

  /**
   * The library as this device now has it.
   *
   * A song that has left the library while it waited is no longer wanted, and
   * not a failure to report: "Cannot download song 47" over an empty Library
   * was forty-three songs removed with one of them still queued. Forgotten
   * before the map is replaced, so its half-written file is still one this
   * queue knows how to throw away.
   *
   * With `authoritative`, a song already kept here that the library no longer
   * names goes too — the bucket is the library, and a removal made on any
   * device is a removal here (docs/SYNC.md). Only when the list really is
   * the library: an answer that has not arrived yet is an empty list too, and
   * deleting every download over it would be the wrong kind of memorable.
   */
  configure(
    connection: Connection,
    songs: readonly Song[],
    options: { authoritative?: boolean } = {},
  ): void {
    this.#storage.configure?.(connection, songs)
    const listed = new Set(songs.map(song => song.id))
    this.#forget(this.#state.queue.filter(id => !listed.has(id)))
    this.#songsById = new Map(songs.map(song => [song.id, song]))
    if (!options.authoritative) return
    const gone = Object.values(this.#state.index.entries)
      .map(entry => entry.songId)
      .filter(songId => !listed.has(songId))
    if (gone.length > 0) void this.remove(gone)
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

  /**
   * Where a kept song is, for a player that takes a URL; null when it is not
   * kept — or when the file on disk is not this song's any more.
   *
   * `rev` is what the library says the song is now. A file whose entry
   * remembers a different one is the right name over the wrong audio
   * (`entryIsCurrent`), so it is not offered: the song streams, and the
   * catch-up pass replaces the copy. The bytes are left alone, because on a
   * plane a stale copy is still better than none and only playback can tell
   * the difference.
   */
  localUri(songId: number, rev?: string): string | null {
    const entry = entryFor(this.#state.index, songId)
    if (!entryIsCurrent(entry, rev)) return null
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
    this.#callOff()
    this.#resumedWhileRunning = false
    this.#patch({ queue: [], activeSongId: null, bytesWritten: 0, totalBytes: 0, paused: false })
  }

  /** Stop whatever is being fetched, and throw its half-written file away. */
  #callOff(): void {
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
  }

  /**
   * Take these songs out of the queue, calling off the one in flight if it is
   * among them. The rest of the queue carries on: the loop skips a cancelled
   * song the way it skips a finished one.
   */
  #forget(songIds: readonly number[]): void {
    if (songIds.length === 0) return
    const gone = new Set(songIds)
    const queue = this.#state.queue.filter(id => !gone.has(id))
    if (queue.length === this.#state.queue.length) return
    const active = this.#state.activeSongId
    if (active !== null && gone.has(active)) {
      this.#callOff()
      this.#patch({ queue, activeSongId: null, bytesWritten: 0, totalBytes: 0 })
      return
    }
    this.#patch({ queue })
  }

  /**
   * Forget the last failure. It is kept so it can be seen, and while it is
   * there nothing downloads by itself; a fresh start (Wi-Fi back) clears it.
   */
  clearError(): void {
    if (this.#state.error !== null) this.#patch({ error: null })
  }

  /**
   * Throw these songs' files away, and forget only the ones that went.
   *
   * The index is committed after the deletes settle, not before: a song whose
   * file could not be removed keeps its entry, so its bytes still count towards
   * "n songs kept" and the storage figure, and the next remove tries it again.
   * Forgetting first and deleting after, without waiting, left an orphan — a
   * file with no entry, which nothing could see and "Remove all" did not tally.
   */
  async remove(songIds: readonly number[]): Promise<void> {
    // Not wanted on this device any more, so not to be fetched either.
    this.#forget(songIds)
    const kept = songIds
      .map(songId => entryFor(this.#state.index, songId))
      .filter(entry => entry !== null)
    const settled = await Promise.allSettled(kept.map(entry => this.#storage.delete(entry)))

    let index = this.#state.index
    const failures: string[] = []
    settled.forEach((result, position) => {
      const entry = kept[position]
      if (entry === undefined) return
      if (result.status === 'fulfilled') {
        index = removeEntry(index, entry.songId)
        return
      }
      const title = this.#songsById.get(entry.songId)?.title ?? `song ${entry.songId}`
      const reason = result.reason instanceof Error ? result.reason.message : null
      failures.push(reason ? `${title}: not removed (${reason})` : `${title}: not removed`)
    })

    await this.#commit(index)
    // Told after the commit, the way a failed download is: one line, the first
    // failure by name, and how many more went the same way.
    const [first, ...rest] = failures
    if (first !== undefined) {
      this.#patch({ error: rest.length === 0 ? first : `${first}, and ${rest.length} more` })
    }
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
      // Every chunk, from a fast source. The state takes each one; listeners
      // hear of them at a pace a screen can draw, and the next change of any
      // other kind carries the latest bytes with it.
      this.#state = {
        ...this.#state,
        bytesWritten,
        totalBytes: totalBytes > 0 ? totalBytes : expectedBytes,
      }
      this.#progressNotice.request()
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

      this.#failures = 0
      this.#pausedSongId = null
      this.#transfer = null
      await this.#commit(
        addEntry(this.#state.index, {
          songId,
          fileName: fileNameFor(song),
          sizeBytes: written,
          etag: listed?.etag ?? '',
          rev: song.rev,
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
        this.#failures = 0
        return true
      }
      /*
       * Tried again, from the start, before it counts as failed. A moment
       * without Wi-Fi ended a song's download for good, and the error it left
       * stopped automatic downloads until something was downloaded by hand.
       */
      const delay = this.#retryDelaysMs[this.#failures]
      if (delay !== undefined) {
        this.#failures += 1
        await this.#wait(delay)
        // Paused or called off while it waited: that decides, not this.
        if (this.#state.paused) return false
        if (this.#state.queue[0] !== songId) {
          this.#failures = 0
          return true
        }
        return this.#downloadOne(songId)
      }
      this.#failures = 0
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
    // Told now, with whatever progress was waiting folded in: a pause, a
    // finish or a failure is never held back behind a progress interval.
    this.#progressNotice.settle()
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#state)
  }
}
