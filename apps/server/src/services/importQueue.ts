import path from 'node:path'
import fsp from 'node:fs/promises'
import { sanitizeFilename, type ImportJob, type Settings } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { ImportRepository } from '../repositories/imports.js'
import type { SongRepository } from '../repositories/songs.js'
import type { TagRepository } from '../repositories/tags.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { SettingsRepository } from '../repositories/settings.js'
import type { ScannerService } from './scanner.js'
import type { LyricsService } from './lyrics.js'
import type { CoverService } from './covers.js'
import type { YtDlpService } from './ytdlp.js'

/**
 * The download worker.
 *
 * Jobs live in SQLite; this class is the loop that drains them. It runs a
 * bounded number of downloads at once (more parallelism does not make a home
 * connection faster and does make YouTube throttle), retries transient
 * failures with a backoff, and can be cancelled mid-download.
 *
 * The loop is deliberately pull-based rather than event-driven: after every
 * completed job it asks the database for the next one, so a job added by
 * another device — or one left over from before a restart — is picked up
 * without any coordination.
 */

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 5_000

export class ImportQueueService {
  readonly #config: Config
  readonly #storage: StorageDriver
  readonly #imports: ImportRepository
  readonly #songs: SongRepository
  readonly #tags: TagRepository
  readonly #playlists: PlaylistRepository
  readonly #settings: SettingsRepository
  readonly #scanner: ScannerService
  readonly #lyrics: LyricsService
  readonly #covers: CoverService
  readonly #ytdlp: YtDlpService
  readonly #logger: Logger

  /** Abort controllers for in-flight jobs, so cancel can actually stop them. */
  readonly #inFlight = new Map<string, AbortController>()
  #activeCount = 0
  #draining = false
  #stopped = false

  constructor(deps: {
    config: Config
    storage: StorageDriver
    imports: ImportRepository
    songs: SongRepository
    tags: TagRepository
    playlists: PlaylistRepository
    settings: SettingsRepository
    scanner: ScannerService
    lyrics: LyricsService
    covers: CoverService
    ytdlp: YtDlpService
    logger: Logger
  }) {
    this.#config = deps.config
    this.#storage = deps.storage
    this.#imports = deps.imports
    this.#songs = deps.songs
    this.#tags = deps.tags
    this.#playlists = deps.playlists
    this.#settings = deps.settings
    this.#scanner = deps.scanner
    this.#lyrics = deps.lyrics
    this.#covers = deps.covers
    this.#ytdlp = deps.ytdlp
    this.#logger = deps.logger.child('import')
  }

  /** Called once at boot: requeue anything a crash left mid-flight. */
  start(): void {
    const orphaned = this.#imports.resetOrphaned()
    if (orphaned > 0) this.#logger.info('requeued interrupted jobs', { count: orphaned })
    this.#imports.pruneOlderThanDays(30)
    this.kick()
  }

  stop(): void {
    this.#stopped = true
    for (const controller of this.#inFlight.values()) controller.abort()
    this.#inFlight.clear()
  }

  /** Downloads in flight right now; other background work yields to them. */
  get activeCount(): number {
    return this.#activeCount
  }

  /** Ask the worker to look for work. Safe to call as often as you like. */
  kick(): void {
    if (this.#stopped) return
    this.#drain()
  }

  cancel(jobId: string): boolean {
    const controller = this.#inFlight.get(jobId)
    controller?.abort()
    const cancelled = this.#imports.cancel(jobId)
    if (cancelled) this.kick()
    return cancelled
  }

  retry(jobId: string): boolean {
    const retried = this.#imports.retry(jobId)
    if (retried) this.kick()
    return retried
  }

  /**
   * The scheduler.
   *
   * Only one drain loop runs at a time (`#draining`); it starts jobs until the
   * concurrency limit is reached, then returns. Each finished job kicks the
   * loop again, so the queue keeps flowing without a polling timer.
   */
  #drain(): void {
    if (this.#draining || this.#stopped) return
    this.#draining = true

    try {
      const limit = this.#settings.get().importConcurrency
      while (this.#activeCount < limit && !this.#stopped) {
        const job = this.#imports.claimNext()
        if (!job) break

        this.#activeCount++
        void this.#process(job)
          .catch(error => {
            this.#logger.error('job crashed', {
              jobId: job.id,
              message: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            this.#activeCount--
            this.#inFlight.delete(job.id)
            // Look for more work once this slot frees up.
            setTimeout(() => this.kick(), 0)
          })
      }
    } finally {
      this.#draining = false
    }
  }

  async #process(job: ImportJob): Promise<void> {
    const controller = new AbortController()
    this.#inFlight.set(job.id, controller)
    const settings = this.#settings.get()

    this.#logger.info('importing', { title: job.title || job.url, attempt: job.attempts })

    try {
      const songId = await this.#runJob(job, settings, controller.signal)
      this.#imports.update(job.id, {
        status: 'done',
        step: 'finished',
        progress: 100,
        songId,
        error: null,
      })
      this.#logger.info('imported', { songId, title: job.title })
    } catch (error) {
      if (controller.signal.aborted) {
        this.#imports.update(job.id, { status: 'cancelled', step: 'finished', error: null })
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      const current = this.#imports.byId(job.id)
      const attempts = current?.attempts ?? job.attempts

      if (attempts < MAX_ATTEMPTS && isRetryable(message)) {
        this.#logger.warn('import failed, will retry', { message, attempt: attempts })
        this.#imports.update(job.id, { status: 'queued', step: 'waiting', error: message })
        setTimeout(() => this.kick(), RETRY_DELAY_MS)
        return
      }

      this.#logger.error('import failed', { message, url: job.url })
      this.#imports.update(job.id, { status: 'error', step: 'finished', error: message })
    }
  }

  async #runJob(job: ImportJob, settings: Settings, signal: AbortSignal): Promise<number> {
    const tools = await this.#ytdlp.status()
    if (!tools.ytdlp) {
      throw new Error('yt-dlp is not installed — run: brew install yt-dlp ffmpeg')
    }

    // Fill in any metadata the client did not already provide.
    let { title, artist, album, duration } = job
    let thumbnail = job.thumbnail

    if (!title.trim()) {
      this.#imports.update(job.id, { step: 'resolving' })
      const probed = await this.#ytdlp.probe(job.url, signal)
      const track = probed.tracks[0]
      if (track) {
        title = track.title || title
        artist = artist || track.artist
        album = album || track.album
        duration = duration || track.duration
        thumbnail ??= track.thumbnail
        this.#imports.update(job.id, { title, artist, album, duration })
      }
    }

    if (!title.trim()) throw new Error('could not work out a title for this track')

    // --- download -----------------------------------------------------------

    this.#imports.update(job.id, { step: 'downloading', progress: 0 })

    const baseName = uniqueBaseName(
      sanitizeFilename(artist.trim() ? `${artist} - ${title}` : title) || 'untitled',
      job.id,
    )

    // yt-dlp writes to the real filesystem, so downloads always land in a local
    // staging directory first and are then handed to the storage driver. That
    // is what keeps object storage a drop-in swap.
    const stagingDir = path.join(this.#config.dataDir, 'incoming')
    await fsp.mkdir(stagingDir, { recursive: true })

    const before = new Set(await safeReaddir(stagingDir))

    await this.#ytdlp.download({
      url: job.url,
      outputTemplate: path.join(stagingDir, `${baseName}.%(ext)s`),
      hasFfmpeg: tools.ffmpeg,
      signal,
      onProgress: percent => this.#imports.update(job.id, { progress: percent }),
    })

    const after = await safeReaddir(stagingDir)
    const downloaded = after.find(name => !before.has(name) && name.startsWith(baseName))
    if (!downloaded) throw new Error('the download finished but no file appeared')

    const stagedPath = path.join(stagingDir, downloaded)

    try {
      // --- move into the library -------------------------------------------

      this.#imports.update(job.id, { step: 'converting', progress: null })

      const extension = path.extname(downloaded)
      const libraryKey = await this.#uniqueLibraryKey(baseName + extension)

      const data = await fsp.readFile(stagedPath)
      await this.#storage.write(libraryKey, data)

      const realDuration = duration || (await this.#ytdlp.probeDuration(stagedPath))

      // --- lyrics -----------------------------------------------------------

      if (settings.autoFetchLyrics) {
        this.#imports.update(job.id, { step: 'lyrics' })
        const remote = await this.#lyrics.fetchRemote({
          artist,
          title,
          album,
          duration: realDuration,
        })
        if (remote) {
          await this.#lyrics
            .writeSidecar(libraryKey, remote.text, remote.synced)
            .catch(() => undefined)
        }
      }

      // --- save -------------------------------------------------------------

      this.#imports.update(job.id, { step: 'saving' })

      const songId = await this.#scanner.ingest(libraryKey)

      // Trust the user's chosen metadata over whatever was in the file tags.
      this.#songs.patch(songId, {
        title: title.trim(),
        artist: artist.trim(),
        album: album.trim(),
      })

      const song = this.#songs.byId(songId)
      if (song && !song.hasArt && thumbnail) {
        await this.#covers.saveFromUrl(songId, thumbnail)
      }

      // Per-import tags plus the global defaults.
      const tagIds = new Set([...job.tagIds, ...settings.defaultImportTagIds])
      for (const tagId of this.#tags.exists([...tagIds])) {
        this.#tags.addToSong(songId, tagId)
      }

      const playlistId = this.#imports.playlistFor(job.id)
      if (playlistId !== null && this.#playlists.byId(playlistId)) {
        this.#playlists.add(playlistId, [songId])
      }

      return songId
    } finally {
      await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    }
  }

  /** Avoid overwriting an existing file with the same artist and title. */
  async #uniqueLibraryKey(preferred: string): Promise<string> {
    if (!(await this.#storage.exists(preferred))) return preferred

    const extension = path.extname(preferred)
    const stem = preferred.slice(0, -extension.length)
    for (let n = 2; n < 100; n++) {
      const candidate = `${stem} (${n})${extension}`
      if (!(await this.#storage.exists(candidate))) return candidate
    }
    return `${stem} (${Date.now()})${extension}`
  }
}

/**
 * Distinguish "try again in a moment" from "this will never work".
 *
 * Retrying a private or deleted video just wastes time and makes the failure
 * take three times as long to surface.
 */
function isRetryable(message: string): boolean {
  const permanent = [
    'private video',
    'video unavailable',
    'members-only',
    'age-restricted',
    'sign in to confirm',
    'removed by the uploader',
    'not installed',
    'no title',
    'copyright',
  ]
  const lower = message.toLowerCase()
  return !permanent.some(phrase => lower.includes(phrase))
}

/** yt-dlp appends its own suffixes; the job id keeps concurrent jobs apart. */
function uniqueBaseName(base: string, jobId: string): string {
  return `${base} [${jobId.slice(0, 8)}]`
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}
