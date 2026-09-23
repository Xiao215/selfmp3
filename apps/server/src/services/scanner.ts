import path from 'node:path'
import { mimeForExtension, type ScanResult } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { SongRepository } from '../repositories/songs.js'
import type { MetadataService } from './metadata.js'
import type { LyricsService } from './lyrics.js'
import type { CoverService } from './covers.js'

/**
 * Sweeping the inbox folder.
 *
 * The folder is not the library (docs/SYNC.md): the bucket is, and a file here
 * is on its way there. An import writes its download here, and a file dropped
 * in by hand is an import too. Either way the sweep makes a song of any audio
 * file it does not know, the cloud pass uploads it, and once every part of it
 * is in the bucket the pass deletes the copy here.
 *
 * Two rules shape this:
 *
 *  - A file that is new gets fully parsed and inserted.
 *  - A file whose time is unchanged is skipped entirely, so a sweep over a
 *    folder with nothing new in it costs a stat per file.
 *
 * A path the database knows and the folder does not is the ordinary state of
 * every uploaded song, and says nothing: a song leaves the library only when
 * someone removes it.
 */
export class ScannerService {
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #metadata: MetadataService
  readonly #lyrics: LyricsService
  readonly #covers: CoverService
  readonly #logger: Logger
  #running = false

  /**
   * Called after a file is ingested — `added` for a new song, `updated` when
   * the file changed underneath an existing one. Nullable callback properties
   * rather than an event emitter, the same shape the player engine uses.
   */
  onIngested: ((songId: number, change: 'added' | 'updated') => void) | null = null
  /** Called once a full sweep finishes, whatever it found. */
  onScanComplete: ((result: ScanResult) => void) | null = null

  constructor(deps: {
    config: Config
    storage: StorageDriver
    songs: SongRepository
    metadata: MetadataService
    lyrics: LyricsService
    covers: CoverService
    logger: Logger
  }) {
    this.#storage = deps.storage
    this.#songs = deps.songs
    this.#metadata = deps.metadata
    this.#lyrics = deps.lyrics
    this.#covers = deps.covers
    this.#logger = deps.logger.child('scan')
  }

  get isRunning(): boolean {
    return this.#running
  }

  /**
   * Ingest one file. Safe to call on a file that is already known — it will
   * refresh the derived fields and leave user edits alone.
   */
  async ingest(key: string): Promise<number> {
    const stat = await this.#storage.stat(key)
    if (!stat) throw new Error(`file not found in library: ${key}`)

    const metadata = await this.#metadata.read(key)
    const lyricsKind = await this.#lyrics.detectKind(key, metadata.embeddedLyrics)
    const mime = mimeForExtension(path.extname(key))

    /*
     * Look the song up only now that the slow part is done.
     *
     * Reading tags and sniffing lyrics both wait, and an import finishing in
     * that gap can insert this very path — `songs.path` is unique, so an
     * insert decided before the wait would fail on arrival. Deciding after it
     * leaves no gap at all: everything from here on is synchronous.
     */
    const existing = this.#songs.byPath(key)

    if (existing) {
      this.#songs.updateScanned({
        id: existing.id,
        duration: metadata.duration || existing.duration,
        sizeBytes: stat.sizeBytes,
        mime,
        mtimeMs: Math.floor(stat.modifiedAt.getTime()),
        lyricsKind,
      })
      if (!existing.hasArt && metadata.picture) {
        await this.#covers.save(existing.id, metadata.picture.data, metadata.picture.extension)
      }
      this.onIngested?.(existing.id, 'updated')
      return existing.id
    }

    const id = this.#songs.insert({
      path: key,
      title: metadata.title || path.basename(key),
      artist: metadata.artist,
      album: metadata.album,
      albumArtist: metadata.albumArtist,
      trackNo: metadata.trackNo,
      year: metadata.year,
      duration: metadata.duration,
      sizeBytes: stat.sizeBytes,
      mime,
      mtimeMs: Math.floor(stat.modifiedAt.getTime()),
      hasArt: false,
      artExt: null,
      lyricsKind,
      sourceUrl: null,
    })

    if (metadata.picture) {
      await this.#covers.save(id, metadata.picture.data, metadata.picture.extension)
    }

    this.onIngested?.(id, 'added')
    return id
  }

  /**
   * One sweep of the folder.
   *
   * Guarded against concurrent runs: two overlapping sweeps would race on the
   * same rows for no benefit, so a second caller gets a no-op result.
   */
  async scan(): Promise<ScanResult> {
    if (this.#running) {
      this.#logger.debug('scan already in progress, skipping')
      return { added: 0, updated: 0, total: this.#songs.count(), durationMs: 0 }
    }

    this.#running = true
    const startedAt = Date.now()
    let added = 0
    let updated = 0
    let skipped = 0

    try {
      const onDisk = await this.#storage.list()
      const known = this.#songs.allPaths()

      for (const key of onDisk) {
        /*
         * One file the sweep cannot read must not end the sweep.
         *
         * A truncated download, a permission the copy did not carry, a format
         * the tag reader gives up on: any of these throws, and letting it out
         * of the loop means every file after it is never looked at. So the bad
         * file is reported and the sweep goes on without it.
         */
        try {
          const existing = known.get(key)
          if (existing) {
            const stat = await this.#storage.stat(key)
            const mtimeMs = stat ? Math.floor(stat.modifiedAt.getTime()) : 0
            // Unchanged file: a sweep that finds nothing new must not touch
            // anything, or the quiet sweep is a write per song and a refetch on
            // every device.
            if (stat && mtimeMs === existing.mtimeMs) continue
            await this.ingest(key)
            updated++
          } else {
            await this.ingest(key)
            added++
          }
        } catch (error) {
          skipped++
          this.#logger.warn('could not read a file, skipping it', {
            path: key,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } finally {
      this.#running = false
    }

    const result: ScanResult = {
      added,
      updated,
      total: this.#songs.count(),
      durationMs: Date.now() - startedAt,
    }

    this.#logger.info('scan complete', {
      added,
      updated,
      ...(skipped > 0 ? { skipped } : {}),
      total: result.total,
      ms: result.durationMs,
    })

    this.onScanComplete?.(result)
    return result
  }
}
