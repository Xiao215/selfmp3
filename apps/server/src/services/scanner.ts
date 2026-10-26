import fsp from 'node:fs/promises'
import path from 'node:path'
import { audioKey, messageOf, mimeForExtension, type ScanResult } from '@selfmp3/shared'
import { sha256 } from '../util/hash.js'
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
 * Three rules shape this:
 *
 *  - A file that is new gets fully parsed and inserted.
 *  - A file whose time is unchanged is skipped entirely, so a sweep over a
 *    folder with nothing new in it costs a stat per file.
 *  - A file changed in the last `SETTLE_MS` is still arriving — a copy, a
 *    download, an encoder writing in place — and is left for a sweep of its
 *    own once it has been still that long. Read half-written, it would be a
 *    song cut short, or a read that never ends (`MetadataService.read`).
 *
 * A path the database knows and the folder does not is the ordinary state of
 * every uploaded song, and says nothing: a song leaves the library only when
 * someone removes it. Its name is still the song's, though, so a file that
 * turns up there is a new song unless its bytes are that song's audio in the
 * bucket (`#isAnotherSong`): taken for the old song, its audio replaced the
 * old one's, and the old one was deleted from the bucket.
 */
/** How long a file has to have been left alone before it is read: it may still be being written. */
const SETTLE_MS = 2_000

export class ScannerService {
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #metadata: MetadataService
  readonly #lyrics: LyricsService
  readonly #covers: CoverService
  readonly #logger: Logger
  readonly #settleMs: number
  #running = false
  #stopped = false
  /** The sweep that comes back for files still arriving. */
  #again: ReturnType<typeof setTimeout> | null = null

  /**
   * Called after a file is ingested — `added` for a new song, `updated` when
   * the file changed underneath an existing one. Nullable callback properties
   * rather than an event emitter, the same shape the player engine uses.
   */
  onIngested: ((songId: number, change: 'added' | 'updated') => void) | null = null
  /** Whether a removed song's copy at this path is still being deleted (`SongRemovalService.isLeaving`). */
  isLeaving: ((key: string) => boolean) | null = null
  /** The key of this song's audio in the bucket, once it is up (`cloud_songs`). */
  bucketAudio: ((songId: number) => string | null) | null = null
  /**
   * Called once a full sweep finishes, whatever it found — one the scanner
   * started itself for files that were still arriving as well.
   */
  onScanComplete: ((result: ScanResult) => void) | null = null

  constructor(deps: {
    storage: StorageDriver
    songs: SongRepository
    metadata: MetadataService
    lyrics: LyricsService
    covers: CoverService
    logger: Logger
    /** `SETTLE_MS`, for tests that write a file and sweep at once. */
    settleMs?: number
  }) {
    this.#storage = deps.storage
    this.#songs = deps.songs
    this.#metadata = deps.metadata
    this.#lyrics = deps.lyrics
    this.#covers = deps.covers
    this.#logger = deps.logger.child('scan')
    this.#settleMs = deps.settleMs ?? SETTLE_MS
  }

  get isRunning(): boolean {
    return this.#running
  }

  /** No more sweeps: the library is closing. */
  stop(): void {
    this.#stopped = true
    if (this.#again) clearTimeout(this.#again)
    this.#again = null
  }

  /**
   * Sweep again once the files still arriving have been still for long
   * enough. One running then is left to finish first, and this one waits
   * behind it rather than being its no-op.
   */
  #comeBack(inMs: number): void {
    if (this.#stopped || this.#again) return
    this.#again = setTimeout(() => {
      this.#again = null
      if (this.#stopped) return
      if (this.#running) return this.#comeBack(this.#settleMs)
      this.scan().catch((error: unknown) => {
        this.#logger.warn('a sweep for files still arriving failed', { message: messageOf(error) })
      })
    }, inMs)
    this.#again.unref()
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
    // A song just removed whose copy has not been deleted yet: not a new one.
    if (!existing && this.isLeaving?.(key)) throw new Error(`song being removed: ${key}`)

    if (existing && (await this.#isAnotherSong(existing.id, key))) {
      const aside = await this.#moveAside(key)
      this.#logger.info('a new file has a song’s name, so it is a song of its own', {
        path: key,
        songId: existing.id,
        now: aside,
      })
      return this.ingest(aside)
    }

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

    // Tags read but no audio found: an empty file, text or noise with an audio
    // extension. Not a song, so not a row every device then fails to play.
    if (!(metadata.duration > 0)) throw new Error(`no audio found in ${key}`)

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
   * Whether the file at a song's path is some other audio than the song's in
   * the bucket. Before the song is up the file is its only copy, and a change
   * to it is the song changing; after, the bucket's is the song.
   */
  async #isAnotherSong(songId: number, key: string): Promise<boolean> {
    const inBucket = this.bucketAudio?.(songId) ?? null
    if (!inBucket) return false
    const data = await this.#storage.read(key)
    return audioKey(sha256(data), path.extname(key)) !== inBucket
  }

  /**
   * Give a file a name no song has, beside where it is, with its words: they
   * came with it, and left at the old name they would be the old song's.
   */
  async #moveAside(key: string): Promise<string> {
    const extension = path.posix.extname(key)
    const stem = key.slice(0, key.length - extension.length)
    for (let n = 2; n < 1000; n++) {
      const candidate = `${stem} (${n})${extension}`
      if (this.#songs.byPath(candidate) || (await this.#storage.exists(candidate))) continue
      const sidecar = await this.#lyrics.findSidecar(key)
      await fsp.rename(this.#storage.localPath(key), this.#storage.localPath(candidate))
      if (sidecar) {
        await fsp
          .rename(
            this.#storage.localPath(sidecar.key),
            this.#storage.localPath(`${stem} (${n})${sidecar.extension}`),
          )
          .catch(() => undefined)
      }
      return candidate
    }
    throw new Error(`no free name beside ${key}`)
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
    let arriving = 0
    /** How long until the newest file still arriving has been still for long enough. */
    let settledIn = 0

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
          if (!existing && this.isLeaving?.(key)) continue
          const stat = await this.#storage.stat(key)
          const mtimeMs = stat ? Math.floor(stat.modifiedAt.getTime()) : 0
          // Unchanged file: a sweep that finds nothing new must not touch
          // anything, or the quiet sweep is a write per song and a refetch on
          // every device.
          if (existing && stat && mtimeMs === existing.mtimeMs) continue
          // Either way of now: a file's time can be a moment ahead of this
          // clock. One far ahead is a clock that is wrong, and waiting for it
          // would be waiting for ever.
          const still = startedAt - mtimeMs
          if (stat && Math.abs(still) < this.#settleMs) {
            arriving++
            settledIn = Math.max(settledIn, this.#settleMs - still)
            continue
          }
          if (existing) {
            if ((await this.ingest(key)) === existing.id) updated++
            else added++
          } else {
            await this.ingest(key)
            added++
          }
        } catch (error) {
          skipped++
          this.#logger.warn('could not read a file, skipping it', {
            path: key,
            message: messageOf(error),
          })
        }
      }
    } finally {
      this.#running = false
    }
    if (arriving > 0) this.#comeBack(settledIn)

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
      ...(arriving > 0 ? { arriving } : {}),
      total: result.total,
      ms: result.durationMs,
    })

    this.onScanComplete?.(result)
    return result
  }
}
