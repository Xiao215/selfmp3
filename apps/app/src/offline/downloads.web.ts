import {
  addEntry,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  pendingIds,
  removeEntry,
  type DownloadIndex,
  type OfflineStore,
} from '@selfmp3/client'
import type { Song, SyncManifest } from '@selfmp3/shared'

import { mediaUrlFor } from '../api/client'
import { configureAudioCache, createWebOfflineStore } from '../ports/offline.web'
import type { ServerConnection } from '../server/connection'
import type { DownloadState } from './downloads'

/**
 * Keeping songs on this device, in a browser.
 *
 * The same class shape as the phone's, over the `OfflineStore` port instead of
 * `expo-file-system`. That is deliberate and it is the plan's point: the port
 * names only *where the bytes go*, because ordering, progress, pausing and what
 * to do about a failure are policy, and policy is the same wherever it runs.
 * So this file is the policy again — one song at a time, in order, stoppable —
 * and every screen, `DownloadsProvider` included, is unchanged.
 *
 * That it is a second copy of the policy rather than a shared one is honest
 * about where phase 3 got to: the port and both its halves are done, and the
 * `OfflineProvider` that would hold the policy once is not. Splitting the
 * phone's queue — which works, and which is the only reason the phone plays
 * with no signal — is not something to do without being able to test it in
 * airplane mode.
 *
 * What differs from the phone, and is not policy:
 *
 *   - **There is no local URI.** The browser's service worker intercepts the
 *     ordinary stream URL, so the player never learns a copy was involved.
 *     `localUri` answers null and the engine streams as usual, which is how the
 *     web app has always played offline without a line of code about it.
 *   - **Pausing stops between songs, not mid-song.** The Cache API writes a
 *     whole response; there is no half-written file to resume from. Stopping
 *     after the song in flight is the honest version of pause here.
 */

const store: OfflineStore = createWebOfflineStore()

const INITIAL_STATE: DownloadState = {
  index: EMPTY_INDEX,
  queue: [],
  activeSongId: null,
  bytesWritten: 0,
  totalBytes: 0,
  paused: false,
  error: null,
}

const INDEX_KEY = 'selfmp3.downloads'

type Listener = (state: DownloadState) => void

export class DownloadQueue {
  private state: DownloadState = INITIAL_STATE
  private listeners = new Set<Listener>()
  private running = false
  private cancelled = false
  private connection: ServerConnection | null = null
  private songsById = new Map<number, Song>()
  private manifest: SyncManifest | null = null

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  getState(): DownloadState {
    return this.state
  }

  configure(connection: ServerConnection | null, songs: readonly Song[]): void {
    this.connection = connection
    this.songsById = new Map(songs.map(song => [song.id, song]))
    // The cache needs to know how to fetch a song; it is the same URL the
    // player would have asked for, which is what makes the worker's
    // interception invisible.
    if (connection) {
      const media = mediaUrlFor(connection)
      configureAudioCache({
        streamUrl: songId => media.stream(songId, this.songsById.get(songId)?.rev),
      })
    }
  }

  setManifest(manifest: SyncManifest | null): void {
    this.manifest = manifest
  }

  /** Rebuild the index from what the cache actually holds. */
  async load(): Promise<void> {
    if (!store.available) {
      this.patch({ index: EMPTY_INDEX })
      return
    }
    try {
      const kept = await store.ids()
      const sizes = await store.bytes(kept)
      // The cache is the truth, not the note kept beside it: a browser may
      // have evicted songs since, and an index that disagreed would offer to
      // play something that is gone. So the index is rebuilt from what is
      // actually there rather than read back.
      let index = EMPTY_INDEX
      for (const songId of kept) {
        const song = this.songsById.get(songId)
        index = addEntry(index, {
          songId,
          fileName: song ? fileNameFor(song) : String(songId),
          sizeBytes: sizes.get(songId) ?? 0,
          etag: this.manifest?.entries.find(entry => entry.id === songId)?.etag ?? '',
          downloadedAt: new Date().toISOString(),
        })
      }
      this.commit(index)
    } catch {
      this.patch({ index: EMPTY_INDEX })
    }
  }

  /** Null always: see the note at the top of this file. */
  localUri(): string | null {
    return null
  }

  enqueue(songIds: readonly number[]): void {
    const pending = pendingIds(this.state.index, songIds).filter(
      id => !this.state.queue.includes(id),
    )
    if (pending.length === 0) return
    this.patch({ queue: [...this.state.queue, ...pending], error: null })
    void this.drain()
  }

  pause(): void {
    if (this.state.paused) return
    this.patch({ paused: true })
  }

  resume(): void {
    if (!this.state.paused) return
    this.patch({ paused: false })
    void this.drain()
  }

  cancelAll(): void {
    this.cancelled = true
    this.patch({ queue: [], activeSongId: null, bytesWritten: 0, totalBytes: 0, paused: false })
  }

  async remove(songIds: readonly number[]): Promise<void> {
    let index = this.state.index
    for (const songId of songIds) {
      if (!entryFor(index, songId)) continue
      await store.remove(songId)
      index = removeEntry(index, songId)
    }
    this.commit(index)
  }

  async removeAll(): Promise<void> {
    this.cancelAll()
    await store.clear()
    this.commit(EMPTY_INDEX)
  }

  // --- the work ------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    this.cancelled = false
    try {
      while (!this.state.paused && !this.cancelled && this.state.queue.length > 0) {
        const songId = this.state.queue[0]
        if (songId === undefined) break
        await this.saveOne(songId)
        this.patch({ queue: this.state.queue.filter(id => id !== songId) })
      }
    } finally {
      this.running = false
      if (this.state.queue.length === 0) {
        this.patch({ activeSongId: null, bytesWritten: 0, totalBytes: 0 })
      }
    }
  }

  private async saveOne(songId: number): Promise<void> {
    const song = this.songsById.get(songId)
    const expected = this.manifest?.entries.find(entry => entry.id === songId)?.sizeBytes ?? 0
    this.patch({ activeSongId: songId, bytesWritten: 0, totalBytes: expected, error: null })

    try {
      const written = await store.save(songId, {
        onProgress: fraction => {
          if (fraction === null) return
          this.patch({ bytesWritten: Math.round(fraction * (expected || 1)) })
        },
      })
      this.commit(
        addEntry(this.state.index, {
          songId,
          fileName: song ? fileNameFor(song) : String(songId),
          sizeBytes: written,
          etag: this.manifest?.entries.find(entry => entry.id === songId)?.etag ?? '',
          downloadedAt: new Date().toISOString(),
        }),
      )
    } catch (error) {
      const name = song?.title ?? `Song ${songId}`
      this.patch({
        error: `${name}: ${error instanceof Error ? error.message : 'could not be kept'}`,
      })
    }
  }

  private commit(index: DownloadIndex): void {
    this.patch({ index })
    try {
      window.localStorage.setItem(INDEX_KEY, JSON.stringify(index))
    } catch {
      // The cache is the truth anyway; `load` rebuilds from it.
    }
  }

  private patch(change: Partial<DownloadState>): void {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener(this.state)
  }
}

export type { DownloadState }

export const downloadQueue = new DownloadQueue()
