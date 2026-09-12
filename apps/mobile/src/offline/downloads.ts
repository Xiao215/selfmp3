import { Directory, File, Paths, type DownloadProgress, type DownloadTask } from 'expo-file-system'
import type { Song, SyncManifest } from '@selfmp3/shared'
import { mediaUrl } from '../api/client'
import { nativePlatform, session as cloudSession } from '../cloud'
import type { ServerConnection } from '../server/connection'
import {
  addEntry,
  EMPTY_INDEX,
  entryFor,
  fileNameFor,
  parseIndex,
  pendingIds,
  removeEntry,
  type DownloadIndex,
} from './downloadIndex'

/**
 * The download queue: the effectful half of offline sync.
 *
 * Written as an imperative class with a subscribe callback, the same shape as
 * the web app's `player/engine.ts`, for the same reason — downloads outlive
 * any one screen, so the state cannot live in a component. React subscribes to
 * it (see `DownloadsProvider.tsx`); nothing else needs to know it is a class.
 *
 * One file at a time, on purpose. Parallel downloads over a phone connection
 * to a Mac at home make the whole thing slower and the progress display
 * meaningless, and a single active task is one thing to pause and resume.
 */

const SONGS_DIRECTORY = 'songs'
const INDEX_FILE_NAME = 'downloads.json'

export interface DownloadState {
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

const INITIAL_STATE: DownloadState = {
  index: EMPTY_INDEX,
  queue: [],
  activeSongId: null,
  bytesWritten: 0,
  totalBytes: 0,
  paused: false,
  error: null,
}

type Listener = (state: DownloadState) => void

export class DownloadQueue {
  private state: DownloadState = INITIAL_STATE
  private listeners = new Set<Listener>()
  private task: DownloadTask | null = null
  /** The song `task` is paused on, so resume continues it rather than restarts. */
  private pausedSongId: number | null = null
  private running = false
  /** Resume arrived while the loop was still waiting on a pause; see `drain`. */
  private resumedWhileRunning = false
  /** The transfer was called off, so its failure is not worth reporting. */
  private cancelling = false
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

  /** Called whenever the library or the server connection changes. */
  configure(connection: ServerConnection | null, songs: readonly Song[]): void {
    this.connection = connection
    this.songsById = new Map(songs.map(song => [song.id, song]))
  }

  setManifest(manifest: SyncManifest | null): void {
    this.manifest = manifest
  }

  /** Reads the index from disk. Safe to call more than once. */
  async load(): Promise<void> {
    directory().create({ intermediates: true, idempotent: true })

    const file = indexFile()
    if (!file.exists) {
      this.patch({ index: EMPTY_INDEX })
      return
    }

    try {
      this.patch({ index: parseIndex(JSON.parse(await file.text())) })
    } catch {
      // Unreadable index: the audio is still there, it will just be fetched
      // again. Losing the index is annoying, not dangerous.
      this.patch({ index: EMPTY_INDEX })
    }
  }

  /** `file://` URI of a downloaded song, or null when it is not on disk. */
  localUri(songId: number): string | null {
    const entry = entryFor(this.state.index, songId)
    if (!entry) return null
    const file = new File(directory(), entry.fileName)
    return file.exists ? file.uri : null
  }

  enqueue(songIds: readonly number[]): void {
    const fresh = pendingIds(this.state.index, songIds).filter(id => !this.state.queue.includes(id))
    if (fresh.length === 0) return
    this.patch({ queue: [...this.state.queue, ...fresh], error: null })
    void this.drain()
  }

  /**
   * Pause after the current chunk.
   *
   * The task is *kept* rather than thrown away: it holds the platform's resume
   * data, and resuming from it continues the same transfer instead of starting
   * a forty-megabyte file again from zero.
   */
  pause(): void {
    if (this.state.paused) return
    this.patch({ paused: true })
    // A task that has already stopped throws when asked to stop again, and
    // this is called straight from a button.
    if (this.task?.state !== 'paused') {
      try {
        this.task?.pause()
      } catch {
        // Already finished or cancelled; the flag above is what matters.
      }
    }
  }

  resume(): void {
    if (!this.state.paused) return
    this.patch({ paused: false })
    /*
     * `pause()` returns before the transfer has actually stopped, so Resume
     * tapped quickly enough arrives while the loop is still waiting on it.
     * Starting a second loop here would do nothing — one is already running —
     * and it will then break on a pause nobody is waiting for any more, so it
     * is told to pick up again once it has.
     */
    if (this.running) {
      this.resumedWhileRunning = true
      return
    }
    void this.drain()
  }

  /** Abandon everything queued. Files already downloaded are untouched. */
  cancelAll(): void {
    // Whatever was part-way through leaves a part of a file behind — cancelling
    // an active transfer and cancelling a paused one both do — and nothing
    // else ever comes back for it.
    this.discardPartial()
    this.cancelling = true
    try {
      this.task?.cancel()
    } catch {
      // Already gone; nothing to call off.
    }
    this.task = null
    this.pausedSongId = null
    this.resumedWhileRunning = false
    this.patch({ queue: [], activeSongId: null, bytesWritten: 0, totalBytes: 0, paused: false })
  }

  /** Delete the half-written file of whatever was being fetched, if any. */
  private discardPartial(): void {
    const songId = this.state.activeSongId
    const song = songId === null ? undefined : this.songsById.get(songId)
    if (!song) return
    // Only a song not yet in the index: a finished one is a real download.
    if (entryFor(this.state.index, song.id)) return
    const file = new File(directory(), fileNameFor(song))
    if (file.exists) file.delete()
  }

  async remove(songIds: readonly number[]): Promise<void> {
    let index = this.state.index
    for (const songId of songIds) {
      const entry = entryFor(index, songId)
      if (!entry) continue
      const file = new File(directory(), entry.fileName)
      if (file.exists) file.delete()
      index = removeEntry(index, songId)
    }
    await this.commit(index)
  }

  async removeAll(): Promise<void> {
    this.cancelAll()
    const dir = directory()
    if (dir.exists) dir.delete()
    dir.create({ intermediates: true, idempotent: true })
    await this.commit(EMPTY_INDEX)
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (!this.state.paused && this.state.queue.length > 0) {
        const songId = this.state.queue[0]
        if (songId === undefined) break
        const finished = await this.downloadOne(songId)
        // A pause leaves the song at the head of the queue so resuming picks
        // it up again; anything else (success or failure) moves on.
        if (!finished) break
        this.patch({ queue: this.state.queue.filter(id => id !== songId) })
      }
    } finally {
      this.running = false
      if (this.state.queue.length === 0) {
        this.task = null
        this.pausedSongId = null
        this.patch({ activeSongId: null, bytesWritten: 0, totalBytes: 0 })
      }
    }

    // Resumed while the loop above was still waiting on a pause. Without this
    // the queue simply stops: not paused, and nothing draining it either.
    if (this.resumedWhileRunning) {
      this.resumedWhileRunning = false
      if (!this.state.paused && this.state.queue.length > 0) void this.drain()
    }
  }

  /** Returns false when the download was paused rather than finished. */
  private async downloadOne(songId: number): Promise<boolean> {
    const connection = this.connection
    const song = this.songsById.get(songId)
    if (!song) {
      this.patch({ error: `Cannot download song ${songId}: it is not in the library` })
      return true
    }

    const fileName = fileNameFor(song)
    const destination = new File(directory(), fileName)

    const expectedBytes =
      this.manifest?.entries.find(entry => entry.id === songId)?.sizeBytes ?? song.sizeBytes

    const onProgress = ({ bytesWritten, totalBytes }: DownloadProgress): void => {
      this.patch({ bytesWritten, totalBytes: totalBytes > 0 ? totalBytes : expectedBytes })
    }

    // Continue a paused transfer where it left off; only start a fresh one
    // when there is nothing to continue.
    const paused = this.pausedSongId === songId && this.task?.state === 'paused' ? this.task : null

    if (!paused) {
      if (destination.exists) destination.delete()
      this.patch({ activeSongId: songId, bytesWritten: 0, totalBytes: expectedBytes, error: null })
      const from = await sourceFor(song, connection, songId)
      this.task = File.createDownloadTask(from.url, destination, {
        ...(from.headers ? { headers: from.headers } : {}),
        // Foreground, against the default. iOS's *background* URLSession is
        // what `createDownloadTask` reaches for, and every download failed
        // against it with `UnableToDownloadException: unknown error` — the
        // same way thirteen covers did, until they stopped using a task at
        // all. What it buys is a transfer that outlives the app being
        // suspended; what it costs, here, is every transfer.
        //
        // Progress, pause and resume all still work; they are the task's, not
        // the session's. Only continuing while the app is away is given up,
        // and a download that does not start continues nothing.
        sessionType: 'foreground',
        onProgress,
      })
    } else {
      this.patch({ activeSongId: songId, error: null })
    }

    const task = this.task
    if (!task) return true

    try {
      const result = paused ? await task.resumeAsync() : await task.downloadAsync()
      if (result === null) {
        // Paused. The task keeps the platform's resume data.
        this.pausedSongId = songId
        return false
      }
      this.pausedSongId = null

      const etag = this.manifest?.entries.find(entry => entry.id === songId)?.etag ?? ''
      await this.commit(
        addEntry(this.state.index, {
          songId,
          fileName,
          sizeBytes: result.size,
          etag,
          downloadedAt: new Date().toISOString(),
        }),
      )
      return true
    } catch (error) {
      if (destination.exists) destination.delete()
      this.task = null
      this.pausedSongId = null
      // A transfer we called off failed because we called it off. Saying so on
      // screen would be reporting the tap back to the person who made it.
      if (this.cancelling) {
        this.cancelling = false
        return true
      }
      this.patch({
        error: `${song.title}: ${error instanceof Error ? error.message : 'download failed'}`,
      })
      return true
    }
  }

  private async commit(index: DownloadIndex): Promise<void> {
    this.patch({ index })
    try {
      indexFile().write(JSON.stringify(index))
    } catch (error) {
      this.patch({
        error: error instanceof Error ? error.message : 'could not save the download index',
      })
    }
  }

  private patch(patch: Partial<DownloadState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }
}

/**
 * Where a song's bytes come from.
 *
 * The bucket, through the doorman, when this device is signed in — and a
 * header rather than a query string, because that is all the doorman reads.
 * `song.path` is already the key there (`audio/<sha256>.<ext>`), since
 * snapshotLibrary.ts puts it there.
 *
 * Otherwise a Mac, where the token has to ride in the query string: this URL
 * is also handed to the OS audio player, which cannot attach headers.
 */
async function sourceFor(
  song: Song,
  connection: ServerConnection | null,
  songId: number,
): Promise<{ url: string; headers?: Record<string, string> }> {
  const signedIn = await cloudSession.loadSession().catch(() => null)
  if (signedIn) {
    return {
      url: `${nativePlatform.doormanUrl}/v1/files/${song.path}`,
      headers: { Authorization: `Bearer ${signedIn.token}` },
    }
  }
  if (!connection) throw new Error('no server, and not signed in to the cloud')
  return { url: mediaUrl.stream(connection, songId) }
}

function directory(): Directory {
  return new Directory(Paths.document, SONGS_DIRECTORY)
}

function indexFile(): File {
  return new File(Paths.document, INDEX_FILE_NAME)
}

/** One queue for the whole app; downloads must outlive any single screen. */
export const downloadQueue = new DownloadQueue()
