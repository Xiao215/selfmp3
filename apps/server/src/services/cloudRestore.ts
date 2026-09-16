import path from 'node:path'
import type { CloudStatus } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { CloudStore } from '../bucket/store.js'
import { CloudError } from '../bucket/store.js'
import type { CloudRepository, SongToRestore } from '../repositories/cloud.js'
import type { CoverService } from './covers.js'
import type { LyricsService } from './lyrics.js'
import type { ScannerService } from './scanner.js'

/**
 * Fetching the files of songs this server took on from the bucket
 * (services/cloudAdopt.ts, docs/SYNC.md).
 *
 * Adoption gives a new server the whole library as metadata: every song, tag,
 * playlist, play and stamp, each song's row pointing at a path nothing is at
 * yet. This is the other half — the audio, the cover and the words come down
 * from the bucket into the library folder, and the song stops being missing.
 *
 * Three properties matter more than speed, and shape everything here.
 *
 * **It does not hold anything up.** A pass starts it and does not wait for it.
 * A library of two thousand songs is hours of downloading, and publishing,
 * reading other devices' changes and answering requests all have to carry on
 * throughout. One song at a time, with no parallelism to go wrong.
 *
 * **Interrupting it costs nothing.** There is no cursor and no queue file: the
 * queue is a query (`songsToRestore`), and a song leaves it only when its files
 * are on disk and its row says so. Killed between the audio and the cover, the
 * next run finds the audio already there, skips it, and fetches the cover. The
 * library folder's writes are a temp file and a rename, so a half-written audio
 * file is never at the path for anyone to find.
 *
 * **It never fetches what is already here.** Every step asks the disk first.
 * That is what makes resuming free, and it is also what makes this safe to run
 * against a library somebody has been restoring by hand.
 *
 * What it deliberately does not do is fetch a song whose file this server once
 * had and has lost. Both look `missing`; only one of them is this server's to
 * go and get. Quietly re-downloading a library because a drive was unplugged
 * for an afternoon is not a thing anybody asked for — see `songsToRestore`.
 */

/** How it is going, in the shape the cloud status carries it. */
type Progress = NonNullable<CloudStatus['restoring']>

export class CloudRestore {
  readonly #cloud: CloudRepository
  readonly #storage: StorageDriver
  readonly #covers: CoverService
  readonly #lyrics: LyricsService
  readonly #scanner: () => Pick<ScannerService, 'ingest'>
  readonly #logger: Logger

  #running: Promise<void> | null = null
  #progress: Progress | null = null
  #stop = false

  /**
   * Called once a song's files have arrived and it is no longer missing, to
   * move the library version every client watches. The folder watcher would
   * notice these writes eventually and say so itself, but only where there is
   * one — and a library that is quietly filling up is exactly when a phone
   * should be refetching.
   */
  onRestored: ((songId: number) => void) | null = null

  constructor(deps: {
    cloud: CloudRepository
    storage: StorageDriver
    covers: CoverService
    lyrics: LyricsService
    /**
     * Read lazily: the scanner is built after the cloud sync is, and it is what
     * turns a file that has arrived into a song that is no longer missing —
     * duration, size and time from the file itself, exactly as if it had been
     * dropped into the library folder by hand, which is the other way this
     * happens.
     */
    scanner: () => Pick<ScannerService, 'ingest'>
    logger: Logger
  }) {
    this.#cloud = deps.cloud
    this.#storage = deps.storage
    this.#covers = deps.covers
    this.#lyrics = deps.lyrics
    this.#scanner = deps.scanner
    this.#logger = deps.logger.child('restore')
  }

  /** How it is going, for the cloud panel. Null when there is nothing waiting. */
  progress(): Progress | null {
    return this.#progress
  }

  /** Songs still waiting for their files. Cheap: one indexed query. */
  waiting(): number {
    return this.#cloud.songsToRestore().length
  }

  /**
   * Fetch what is waiting, in the background. Returns at once if a run is
   * already going, so a pass can call this every time without thinking.
   */
  start(store: CloudStore, stillOurs: () => boolean): void {
    if (this.#running) return
    this.#stop = false
    this.#running = this.#run(store, stillOurs).finally(() => {
      this.#running = null
      this.#progress = null
    })
  }

  /** Stop after the song in hand. The rest are still in the query next time. */
  stop(): void {
    this.#stop = true
  }

  /** Resolves once no run is going. For tests, and for shutting down. */
  async whenIdle(): Promise<void> {
    while (this.#running) await this.#running
  }

  async #run(store: CloudStore, stillOurs: () => boolean): Promise<void> {
    const waiting = this.#cloud.songsToRestore()
    if (waiting.length === 0) return
    this.#logger.info('fetching the files of songs taken on from the bucket', {
      songs: waiting.length,
    })

    let done = 0
    let failed = 0
    for (const song of waiting) {
      if (this.#stop || !stillOurs()) break
      this.#progress = { done, total: waiting.length, current: song.title }
      try {
        await this.#restore(store, song)
      } catch (error) {
        // Offline, a refused key, no bucket: nothing else will work either, and
        // the pass that starts this again will say what is wrong.
        if (error instanceof CloudError && error.kind !== 'other') {
          this.#logger.warn('stopping until the bucket is reachable again', {
            message: error.message,
          })
          break
        }
        failed++
        this.#logger.warn('could not fetch a song from the bucket', {
          songId: song.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      done++
      this.#progress = { done, total: waiting.length, current: null }
    }
    this.#logger.info('finished a pass of fetching', { done, failed, of: waiting.length })
  }

  /**
   * One song's files. Each step is skipped when its file is already here, which
   * is both how a run resumes and how a second run over a finished library
   * costs a handful of `stat` calls and no downloads at all.
   */
  async #restore(store: CloudStore, song: SongToRestore): Promise<void> {
    const here = await this.#storage.stat(song.path)
    if (!here || here.sizeBytes !== song.audioSize) {
      const audio = await store.get(song.audioKey)
      if (!audio) {
        // The snapshot names a file the bucket does not have. Nothing to be
        // done about it here; the song stays missing and keeps its tags and
        // its plays, and is left out of what this server publishes.
        this.#logger.warn('the bucket has no audio for a song its own snapshot lists', {
          songId: song.id,
          key: song.audioKey,
        })
        return
      }
      await this.#storage.write(song.path, audio)
    }

    if (song.coverKey && !song.hasArt) {
      const cover = await store.get(song.coverKey)
      // The bucket's cover is the one every other device is showing, so it is
      // saved before the scan below, which would otherwise take the audio
      // file's own embedded picture instead.
      if (cover) await this.#covers.save(song.id, cover, path.extname(song.coverKey))
    }

    if (song.lyricsKey && !(await this.#lyrics.findSidecar(song.path))) {
      const words = await store.get(song.lyricsKey)
      if (words) {
        await this.#lyrics.writeSidecar(song.path, words.toString('utf8'), song.lyricsSynced)
      }
    }

    // And now it is an ordinary song with an ordinary file: the scan reads its
    // duration, size and time from what actually arrived and clears `missing`.
    // The next cloud pass then works its signatures out from the files, finds
    // the bucket already has every one of them under the same hashes, and sends
    // nothing.
    await this.#scanner().ingest(song.path)
    this.onRestored?.(song.id)
    this.#logger.debug('fetched a song from the bucket', { songId: song.id })
  }
}
