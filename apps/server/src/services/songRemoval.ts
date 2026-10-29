import { messageOf, tagsEmptiedBy, type BulkDeleteFailure, type Song } from '@selfmp3/shared'
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
  /** Ids whose rows this removed. */
  removed: number[]
  /**
   * Ids that were not in the library to begin with. Gone is what was asked,
   * so these are done, not failed: a delete whose answer was lost and is
   * asked again finds its songs already gone.
   */
  alreadyGone: number[]
  /** Songs whose local copy would not go. */
  failed: BulkDeleteFailure[]
}

/** Rows `take` removed, and the ids it could not, for `settle` to finish. */
interface Taken {
  songs: Song[]
  alreadyGone: number[]
}

/**
 * Rows a removal takes out between two looks at the event loop. Each row's
 * delete cascades through its plays, tags, places and search rows, so a few
 * hundred at once held every other request for most of a second.
 */
const REMOVE_BATCH = 50

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
 * audio is still on this disk, and its files in the bucket. This is the one
 * list of it, so a new kind of derived data is added here and nowhere else.
 *
 * Removing is one thing, everywhere (docs/SYNC.md). There is no "keep the
 * file": this server keeps no copy of the library, so a copy left here would
 * only be the next sweep's new song, and the removed song would come back.
 * The bucket's files are not deleted here but
 * *trashed* (`cloud_trash`): the cloud pass lets them go once the snapshot
 * without the song has gone up and no other song names them.
 *
 * The database is strict and the file system forgiving: the rows go first, in
 * one step, a copy that will not go never keeps the row, and the caller is told
 * which copies it was forgiving about. Between the two, the row's deletion has
 * noted its copy (`SongRepository.isLeaving`), so a sweep in the meantime — or
 * the first one after a crash — does not make a new song of it.
 */
export class SongRemovalService {
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #tags: Pick<TagRepository, 'all' | 'delete'>
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
    tags: Pick<TagRepository, 'all' | 'delete'>
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
   * Ids that are not in the library are already gone, which is what was
   * asked: a phone working from a stale list, or asking again after an answer
   * that never reached it, loses the rows it can and counts the rest as done.
   * The rows go a batch at a time (`take`), with the event loop let go between
   * batches so a thousand-song delete does not starve every other request, and
   * the library version moves once at the end.
   */
  async remove(ids: readonly number[]): Promise<RemovalResult> {
    const requested = [...new Set(ids)]
    const taken: Taken = { songs: [], alreadyGone: [] }
    for (let start = 0; start < requested.length; start += REMOVE_BATCH) {
      if (start > 0) await new Promise(resolve => setImmediate(resolve))
      const batch = this.take(requested.slice(start, start + REMOVE_BATCH))
      taken.songs.push(...batch.songs)
      taken.alreadyGone.push(...batch.alreadyGone)
    }
    return this.settle(taken)
  }

  /**
   * The rows, now: read, trashed and deleted with no wait in between, so two
   * requests can never both see a song that one of them is removing (a second
   * merge of a copy already folded in would count its plays twice). Run it
   * inside the caller's transaction when the removal is part of a larger
   * change, and `settle` what it returns once that has committed.
   */
  take(ids: readonly number[]): Taken {
    const requested = [...new Set(ids)]
    const songs = this.#songs.byIds(requested)
    const found = new Set(songs.map(song => song.id))
    const alreadyGone = requested.filter(id => !found.has(id))

    // Each tag's count before the rows go, to tell which ones they empty.
    const tags = this.#tags.all()
    // The bucket's files first, from the bookkeeping the row's deletion takes
    // with it; then the rows.
    for (const song of songs) this.#cloud.trashSong(song.id)
    const gone = new Set(this.#songs.deleteMany(songs.map(song => song.id)).removed)
    const removed = songs.filter(song => gone.has(song.id))
    // A tag these were the last songs of goes too — only those, as a device
    // removing them takes them (shared `tagsEmptiedBy`): an empty tag made a
    // moment ago is nobody's leftover.
    for (const tagId of tagsEmptiedBy(tags, removed)) this.#tags.delete(tagId)
    return { songs: removed, alreadyGone }
  }

  /**
   * Everything but the rows, for songs `take` took: clients are told, then
   * each song's files are tidied. Side effects one song at a time, and never
   * fatal: the point of a batch is that one bad file does not cost you the
   * other thirty-nine.
   */
  async settle(taken: Taken): Promise<RemovalResult> {
    if (taken.songs.length > 0) this.#onChange()
    const failed: BulkDeleteFailure[] = []
    for (const song of taken.songs) {
      try {
        const problem = await this.#cleanUp(song)
        if (problem) failed.push({ songId: song.id, reason: problem, removed: true })
      } finally {
        this.#songs.copyGone(song.path)
      }
    }
    return { removed: taken.songs.map(song => song.id), alreadyGone: taken.alreadyGone, failed }
  }

  /** Whether this path's song has been removed and its copy is still being tidied away. */
  isLeaving(key: string): boolean {
    return this.#songs.isLeaving(key)
  }

  /**
   * Finish tidying after songs whose rows went and whose copies had not by
   * the time the server stopped — killed in the middle of a big removal, say.
   * Before the first sweep, which would otherwise find those copies. A path a
   * new song has taken since is that song's, and its file stays.
   */
  async finishLeaving(): Promise<void> {
    const left = this.#songs.leaving()
    if (left.length === 0) return
    for (const song of left) {
      try {
        const problem = await this.#cleanUp(song, { copy: !this.#songs.byPath(song.path) })
        if (problem) {
          this.#logger.warn('could not delete a removed song’s copy', {
            path: song.path,
            message: problem,
          })
        }
      } catch (error) {
        this.#logger.warn('could not tidy up a removed song', {
          path: song.path,
          message: messageOf(error),
        })
      } finally {
        this.#songs.copyGone(song.path)
      }
    }
    this.#logger.info('finished tidying after songs removed before the server stopped', {
      songs: left.length,
    })
  }

  /**
   * Tidy after rows another device removed.
   *
   * The cloud pass deleted them inside its own transaction and trashed their
   * bucket files, and the tags they emptied came as changes of their own, so
   * only what hung off each row is left to do. Nothing here is fatal: a cover left behind is not worth
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
          message: messageOf(error),
        })
      } finally {
        this.#songs.copyGone(song.path)
      }
    }
  }

  /**
   * Everything but the row. A problem with the copy on disk is reported rather
   * than thrown; what is derived from the row goes either way, since the row is
   * going. `copy: false` leaves the file at the song's path, which another
   * song has taken since.
   */
  async #cleanUp(
    song: Pick<Song, 'id' | 'path'>,
    { copy = true }: { copy?: boolean } = {},
  ): Promise<string | null> {
    let problem: string | null = null
    try {
      if (copy) {
        if (await this.#storage.exists(song.path)) await this.#storage.delete(song.path)
        await this.#lyrics.deleteSidecar(song.path)
        await removeFolderIfEmpty(this.#storage, song.path)
      }
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
