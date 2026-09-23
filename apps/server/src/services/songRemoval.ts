import type { BulkDeleteFailure, Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { CloudRepository } from '../repositories/cloud.js'
import type { SongRepository } from '../repositories/songs.js'
import type { TagRepository } from '../repositories/tags.js'
import type { LyricsService } from './lyrics.js'
import type { CoverService } from './covers.js'
import type { LyricsCache } from './lyricsCache.js'
import type { MotionStore } from './motionStore.js'
import type { LyricsIndexService } from './lyricsIndex.js'
import { removeFolderIfEmpty } from './libraryLayout.js'

/** What became of a request to remove some songs. */
interface RemovalResult {
  /** Ids whose rows are gone. */
  removed: number[]
  /** Ids that were not found, and songs whose local copy would not go. */
  failed: BulkDeleteFailure[]
}

/** A row another device already removed. */
interface RemovedElsewhere {
  id: number
  path: string
}

/**
 * Taking a song out of the library, all of it.
 *
 * A song is a row and everything that hangs off it — its cover, its lyrics
 * cache, its motion curve, its rows in the lyrics index, whatever copy of its
 * audio is still on this disk, and its files in the bucket. Four places used
 * to spell that list out by hand, and each forgot a different item: this is
 * the one list, so a new kind of derived data is added here and nowhere else.
 *
 * Removing is one thing, everywhere (docs/SYNC.md). There is no "keep the
 * file": this server keeps no copy of the library, so a copy left here would
 * only be the next sweep's new song — which is exactly how forty-three removed
 * songs came back one evening. The bucket's files are not deleted here but
 * *trashed* (`cloud_trash`): the cloud pass lets them go once the snapshot
 * without the song has gone up and no other song names them.
 *
 * The database is strict and the file system forgiving: a copy that will not
 * go never keeps the row, and the caller is told which copies it was forgiving
 * about.
 */
export class SongRemovalService {
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #tags: Pick<TagRepository, 'pruneEmpty'>
  readonly #cloud: Pick<CloudRepository, 'trashSong'>
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
    /** Where a removed song's bucket files wait to be deleted. */
    cloud: Pick<CloudRepository, 'trashSong'>
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
    this.#cloud = deps.cloud
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
  async remove(ids: readonly number[]): Promise<RemovalResult> {
    const requested = [...new Set(ids)]
    const songs = this.#songs.byIds(requested)
    const found = new Set(songs.map(song => song.id))
    const failed: BulkDeleteFailure[] = requested
      .filter(id => !found.has(id))
      .map(id => ({ songId: id, reason: `no song with id ${id}`, removed: false }))

    // Side effects one song at a time, and never fatal: the point of a batch
    // is that one bad file does not cost you the other thirty-nine.
    for (const song of songs) {
      const problem = await this.#cleanUp(song)
      if (problem) failed.push({ songId: song.id, reason: problem, removed: true })
    }

    // The bucket's files first, from the bookkeeping the row's deletion takes
    // with it; then the rows, in one transaction.
    for (const song of songs) this.#cloud.trashSong(song.id)
    const { removed } = this.#songs.deleteMany(songs.map(song => song.id))
    if (removed.length > 0) {
      // A tag these were the last songs of goes too.
      this.#tags.pruneEmpty()
      this.#onChange()
    }
    return { removed, failed }
  }

  /**
   * Tidy after rows another device removed.
   *
   * The cloud pass deleted them inside its own transaction, trashed their
   * bucket files and pruned the tags there, so only what hung off each row is
   * left to do. Nothing here is fatal: a cover left behind is not worth
   * stopping the pass over, and the version bump is the pass's to make.
   */
  async tidyAfter(removed: readonly RemovedElsewhere[]): Promise<void> {
    for (const song of removed) {
      try {
        const problem = await this.#cleanUp(song)
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

  /**
   * Everything but the row. A problem with the copy on disk is reported rather
   * than thrown; what is derived from the row goes either way, since the row is
   * going.
   */
  async #cleanUp(song: Pick<Song, 'id' | 'path'>): Promise<string | null> {
    let problem: string | null = null
    try {
      if (await this.#storage.exists(song.path)) await this.#storage.delete(song.path)
      await this.#lyrics.deleteSidecar(song.path)
      await removeFolderIfEmpty(this.#storage, song.path)
    } catch (error) {
      problem = error instanceof Error ? error.message : 'could not delete the copy on disk'
    }

    await this.#covers.delete(song.id)
    await this.#lyricsCache.delete(song.id)
    await this.#motion.delete(song.id)
    this.#lyricsIndex.remove(song.id)

    return problem
  }
}
