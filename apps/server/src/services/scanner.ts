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
 * Reconciling the library folder with the database.
 *
 * Three rules shape this:
 *
 *  - A file that is new gets fully parsed and inserted.
 *  - A file whose size and mtime are unchanged is skipped entirely. On a large
 *    library this turns a rescan from minutes into milliseconds.
 *  - A file that has disappeared is *marked missing*, not deleted. Tags, play
 *    counts and playlist membership survive an unplugged external drive or a
 *    file being renamed, and come back when it does.
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
  /** Called once a full scan finishes, whatever it found. */
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
   * Full reconciliation.
   *
   * Guarded against concurrent runs: two overlapping scans would race on the
   * same rows for no benefit, so a second caller gets a no-op result.
   */
  async scan(): Promise<ScanResult> {
    if (this.#running) {
      this.#logger.debug('scan already in progress, skipping')
      return { added: 0, updated: 0, removed: 0, total: this.#songs.count(), durationMs: 0 }
    }

    this.#running = true
    const startedAt = Date.now()
    let added = 0
    let updated = 0
    let removed = 0
    let skipped = 0

    try {
      const onDisk = await this.#storage.list()
      const known = this.#songs.allPaths()

      for (const key of onDisk) {
        /*
         * One file the scan cannot read must not end the scan.
         *
         * A truncated download, a permission the copy did not carry, a format
         * the tag reader gives up on: any of these throws, and letting it out
         * of the loop means every file after it is never looked at and the
         * pass that marks deleted songs missing never runs at all. So the bad
         * file is reported and the scan goes on without it.
         */
        try {
          const existing = known.get(key)
          if (existing) {
            const stat = await this.#storage.stat(key)
            const mtimeMs = stat ? Math.floor(stat.modifiedAt.getTime()) : 0
            if (stat && mtimeMs === existing.mtimeMs) {
              /*
               * Unchanged file. The only row that needs writing is one that was
               * marked missing: its file came back, which clients should hear
               * about like any other change. Every other row is left alone —
               * a scan that finds nothing new must not touch anything, or the
               * quiet hourly scan is a write per song and a refetch on every
               * device.
               */
              if (existing.missing) {
                this.#songs.clearMissing(existing.id)
                updated++
              }
              continue
            }
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

      // A song already marked missing stays that way without being counted
      // again: "removed" is what went since the last scan, and a library with
      // one long-gone file must not look changed on every scan.
      const onDiskSet = new Set(onDisk)
      for (const [key, row] of known) {
        if (!onDiskSet.has(key) && !row.missing) {
          this.#songs.markMissing(key)
          removed++
        }
      }
    } finally {
      this.#running = false
    }

    const result: ScanResult = {
      added,
      updated,
      removed,
      total: this.#songs.count(),
      durationMs: Date.now() - startedAt,
    }

    this.#logger.info('scan complete', {
      added,
      updated,
      ...(skipped > 0 ? { skipped } : {}),
      missing: removed,
      total: result.total,
      ms: result.durationMs,
    })

    this.onScanComplete?.(result)
    return result
  }
}
