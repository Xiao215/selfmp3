import type { BulkDeleteFailure, Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { SongRepository } from '../repositories/songs.js'
import type { TagRepository } from '../repositories/tags.js'
import type { LyricsService } from './lyrics.js'
import type { CoverService } from './covers.js'
import type { LyricsCache } from './lyricsCache.js'
import type { MotionStore } from './motionStore.js'
import type { LyricsIndexService } from './lyricsIndex.js'
import { removeFolderIfEmpty } from './libraryLayout.js'

/** What became of a request to remove some songs. */
export interface RemovalResult {
  /** Ids whose rows are gone. */
  removed: number[]
  filesDeleted: number
  /** Ids that were not found, and songs whose audio would not go. */
  failed: BulkDeleteFailure[]
}

/** A row another device already removed, and whether it asked for the audio too. */
export interface RemovedElsewhere {
  id: number
  path: string
  deleteFile: boolean
}

/**
 * Taking a song out of the library, all of it.
 *
 * A song is a row and everything that hangs off it — its cover, its lyrics
 * cache, its motion curve, its rows in the lyrics index, and sometimes the
 * audio and sidecar on disk. Four places used to spell that list out by hand,
 * and each forgot a different item: this is the one list, so a new kind of
 * derived data is added here and nowhere else.
 *
 * Two rules every path shares. The audio goes only when asked — "remove from
 * my list" and "destroy the file" are never the same button — and a file that
 * will not go never keeps the row: the database is strict, the file system is
 * forgiving, and the caller is told which files it was forgiving about.
 */
export class SongRemovalService {
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #tags: Pick<TagRepository, 'pruneEmpty'>
  readonly #lyrics: Pick<LyricsService, 'deleteSidecar'>
  readonly #covers: Pick<CoverService, 'delete'>
  readonly #lyricsCache: Pick<LyricsCache, 'delete'>
  readonly #motion: Pick<MotionStore, 'delete'>
  readonly #lyricsIndex: Pick<LyricsIndexService, 'remove'>
  readonly #onChange: () => void
  readonly #logger: Logger

  constructor(deps: {
    storage: StorageDriver
    songs: SongRepository
    tags: Pick<TagRepository, 'pruneEmpty'>
    lyrics: Pick<LyricsService, 'deleteSidecar'>
    covers: Pick<CoverService, 'delete'>
    lyricsCache: Pick<LyricsCache, 'delete'>
    motion: Pick<MotionStore, 'delete'>
    lyricsIndex: Pick<LyricsIndexService, 'remove'>
    /** Called once per request that took rows out, so clients refetch. */
    onChange: () => void
    logger: Logger
  }) {
    this.#storage = deps.storage
    this.#songs = deps.songs
    this.#tags = deps.tags
    this.#lyrics = deps.lyrics
    this.#covers = deps.covers
    this.#lyricsCache = deps.lyricsCache
    this.#motion = deps.motion
    this.#lyricsIndex = deps.lyricsIndex
    this.#onChange = deps.onChange
    this.#logger = deps.logger.child('remove')
  }

  /**
   * Remove these songs, one request's worth.
   *
   * Ids that are not in the library are reported, not thrown: a phone working
   * from a stale list should lose the rows it can and be told about the rest.
   * The rows go in one transaction and the library version moves once.
   */
  async remove(ids: readonly number[], options: { deleteFile: boolean }): Promise<RemovalResult> {
    const requested = [...new Set(ids)]
    const songs = this.#songs.byIds(requested)
    const found = new Set(songs.map(song => song.id))
    const failed: BulkDeleteFailure[] = requested
      .filter(id => !found.has(id))
      .map(id => ({ songId: id, reason: `no song with id ${id}`, removed: false }))
    return this.#remove(songs, options.deleteFile, failed)
  }

  /**
   * Permanently forget songs whose files are gone.
   *
   * Deliberately a separate, explicit action rather than something a scan does
   * on its own — losing a play history to a temporarily unmounted drive would
   * be unforgivable.
   *
   * Songs taken on from the bucket and still waiting for their audio are
   * missing too, and are not that. They are the library being restored, not a
   * library that is gone, so `missingAndForgettable` leaves them out.
   */
  async purgeMissing(): Promise<number> {
    const { removed } = await this.#remove(this.#songs.missingAndForgettable(), false, [])
    if (removed.length > 0) this.#logger.info('purged missing songs', { count: removed.length })
    return removed.length
  }

  /**
   * Tidy after rows another device removed.
   *
   * The cloud pass deleted them inside its own transaction and pruned the tags
   * there, so only what hung off each row is left to do. Nothing here is
   * fatal: a cover left behind is not worth stopping the pass over, and the
   * version bump is the pass's to make.
   */
  async tidyAfter(removed: readonly RemovedElsewhere[]): Promise<void> {
    for (const song of removed) {
      try {
        const { problem } = await this.#cleanUp(song, song.deleteFile)
        if (problem) {
          this.#logger.warn('could not tidy up a song removed on another device', {
            path: song.path,
            message: problem,
          })
        }
      } catch (error) {
        this.#logger.warn('could not tidy up a song removed on another device', {
          path: song.path,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  async #remove(
    songs: readonly Song[],
    deleteFile: boolean,
    failed: BulkDeleteFailure[],
  ): Promise<RemovalResult> {
    // Side effects one song at a time, and never fatal: the point of a batch
    // is that one bad file does not cost you the other thirty-nine.
    let filesDeleted = 0
    for (const song of songs) {
      const { fileDeleted, problem } = await this.#cleanUp(song, deleteFile)
      if (fileDeleted) filesDeleted++
      if (problem) failed.push({ songId: song.id, reason: problem, removed: true })
    }

    const { removed } = this.#songs.deleteMany(songs.map(song => song.id))
    if (removed.length > 0) {
      // A tag these were the last songs of goes too.
      this.#tags.pruneEmpty()
      this.#onChange()
    }
    return { removed, filesDeleted, failed }
  }

  /**
   * Everything but the row. The audio, its sidecar and the folder they were in
   * go only on request, and a problem there is reported rather than thrown;
   * what is derived from the row goes either way, since the row is going.
   */
  async #cleanUp(
    song: Pick<Song, 'id' | 'path'>,
    deleteFile: boolean,
  ): Promise<{ fileDeleted: boolean; problem: string | null }> {
    let fileDeleted = false
    let problem: string | null = null

    if (deleteFile) {
      try {
        if (await this.#storage.exists(song.path)) {
          await this.#storage.delete(song.path)
          fileDeleted = true
        } else {
          problem = 'the file was already missing from disk'
        }
        await this.#lyrics.deleteSidecar(song.path)
        await removeFolderIfEmpty(this.#storage, song.path)
      } catch (error) {
        problem = error instanceof Error ? error.message : 'could not delete the file'
      }
    }

    await this.#covers.delete(song.id)
    await this.#lyricsCache.delete(song.id)
    await this.#motion.delete(song.id)
    this.#lyricsIndex.remove(song.id)

    return { fileDeleted, problem }
  }
}
