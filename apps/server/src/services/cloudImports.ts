import type { ImportJob, ImportPreview } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { ImportRequest, ImportRequestRepository } from '../repositories/importRequests.js'
import type { ImportRepository } from '../repositories/imports.js'
import type { SyncRepository } from '../repositories/sync.js'

/**
 * Links other devices asked this server to import (docs/SYNC.md).
 *
 * An iPhone cannot run yt-dlp, and YouTube turns data centres away, so a
 * link pasted there becomes a request in its change log; this server reads it
 * with the rest of the log, and here looks the link up — one song or a whole
 * playlist — and queues what the library does not have yet, with the tags
 * and playlist the request named. From then on the jobs are ordinary imports,
 * and each snapshot says how the request is going.
 */
export class CloudImportService {
  readonly #requests: ImportRequestRepository
  readonly #imports: ImportRepository
  readonly #sync: SyncRepository
  readonly #resolve: (url: string) => Promise<ImportPreview>
  readonly #kickQueue: () => void
  readonly #changed: () => void
  readonly #logger: Logger
  #running: Promise<void> | null = null
  /** Asked again during a run: a request may have arrived after it looked. */
  #again = false

  constructor(deps: {
    requests: ImportRequestRepository
    imports: ImportRepository
    sync: SyncRepository
    /** What a link is: its songs, and which the library has already. */
    resolve: (url: string) => Promise<ImportPreview>
    /** Start the import queue on what was added to it. */
    kickQueue: () => void
    /** A request moved on: the next snapshot should say so. */
    changed: () => void
    logger: Logger
  }) {
    this.#requests = deps.requests
    this.#imports = deps.imports
    this.#sync = deps.sync
    this.#resolve = deps.resolve
    this.#kickQueue = deps.kickQueue
    this.#changed = deps.changed
    this.#logger = deps.logger.child('cloud-imports')
  }

  /**
   * Look at every request nothing has looked at yet. A call during a run
   * joins it, and makes it look once more at the end.
   */
  process(): Promise<void> {
    if (this.#running) {
      this.#again = true
      return this.#running
    }
    // Cleared in `.finally`, which always runs after this assignment. Cleared
    // inside the run instead, a run with nothing to do would finish before
    // the assignment, and leave a finished run in place for good.
    this.#running = this.#run().finally(() => {
      this.#running = null
      if (this.#again) {
        this.#again = false
        void this.process()
      }
    })
    return this.#running
  }

  async #run(): Promise<void> {
    for (const request of this.#requests.waiting()) await this.#take(request)
  }

  async #take(request: ImportRequest): Promise<void> {
    let preview: ImportPreview
    try {
      preview = await this.#resolve(request.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#logger.warn('could not look up a link another device sent', {
        url: request.url,
        message,
      })
      this.#requests.finish(request.uid, {
        state: 'failed',
        title: null,
        songUids: [],
        error: message,
      })
      this.#changed()
      return
    }

    // Called off while the link was being looked up.
    if (this.#requests.byUid(request.uid)?.state !== 'waiting') return

    const title =
      preview.kind === 'playlist' ? preview.playlistTitle : (preview.items[0]?.title ?? null)
    const fresh = preview.items.filter(
      item => !item.alreadyHave && !this.#imports.isPending(item.url),
    )
    if (fresh.length === 0) {
      this.#requests.finish(request.uid, {
        state: preview.items.length === 0 ? 'failed' : 'done',
        title,
        songUids: [],
        error: preview.items.length === 0 ? 'There was nothing to import at that link.' : null,
      })
      this.#changed()
      return
    }

    const tagIds = request.tagUids.flatMap(uid => {
      const tag = this.#sync.tag(uid)
      return tag ? [tag.id] : []
    })
    const playlist = request.playlistUid ? this.#sync.playlist(request.playlistUid) : null
    const jobs: ImportJob[] = this.#imports.enqueue(
      fresh.map(item => ({
        url: item.url,
        title: item.title,
        artist: item.artist,
        album: item.album,
        thumbnail: item.thumbnail,
        duration: item.duration,
      })),
      tagIds,
      playlist?.kind === 'manual' ? playlist.id : null,
    )
    this.#requests.startWorking(
      request.uid,
      title,
      jobs.map(job => job.id),
    )
    this.#logger.info('importing a link another device sent', {
      url: request.url,
      songs: jobs.length,
    })
    this.#kickQueue()
    this.#changed()
  }
}
