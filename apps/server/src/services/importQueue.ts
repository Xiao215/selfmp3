import path from 'node:path'
import fsp from 'node:fs/promises'
import { isSquareCoverUrl, sanitizeFilename, type ImportJob, type Settings } from '@selfmp3/shared'
import { stagingDir, type Config } from '../config.js'
import type { KeepAwakeService } from './keepAwake.js'
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
import { RateLimitedError, type YtThrottleService } from './ytThrottle.js'
import { isFreeOnDisk, songKeyCandidates } from './libraryLayout.js'

/**
 * The download worker.
 *
 * Jobs live in SQLite; this class is the loop that drains them. It runs a
 * bounded number of downloads at once (more parallelism does not make a home
 * connection faster and does make YouTube throttle) and can be cancelled
 * mid-download.
 *
 * A job that fails stays failed: there is a Retry button, and a person who can
 * see why it failed makes a better decision about trying again than a loop
 * that cannot read the reason. The one exception is not a failure at all —
 * YouTube refusing the whole address for rate says nothing about the song, so
 * that pauses the queue and puts the job back in it (services/ytThrottle.ts).
 *
 * The loop is deliberately pull-based rather than event-driven: after every
 * completed job it asks the database for the next one, so a job added by
 * another device — or one left over from before a restart — is picked up
 * without any coordination.
 */

/** The part of the cloud sync an import needs: see services/cloudSync.ts. */
interface ImportUploader {
  readonly connected: boolean
  /** Put the song in the bucket and publish a snapshot that has it. */
  uploadSong(songId: number): Promise<void>
  /** A job has finished, one way or another: the next snapshot says how. */
  kick(): void
}

/**
 * The song is in the library on this server, but not yet in the bucket. Kept
 * apart from other failures because retrying it must not download the song
 * again, and because the background sync can still finish the job later.
 */
class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

export class ImportQueueService {
  readonly #config: Pick<Config, 'dataDir'>
  readonly #storage: Pick<StorageDriver, 'write' | 'exists'>
  readonly #imports: ImportRepository
  readonly #songs: Pick<SongRepository, 'byId' | 'patch' | 'setSourceUrl' | 'setInstrumental'>
  readonly #tags: Pick<TagRepository, 'exists' | 'addToSong'>
  readonly #playlists: Pick<PlaylistRepository, 'byId' | 'add'>
  readonly #settings: Pick<SettingsRepository, 'get'>
  readonly #scanner: Pick<ScannerService, 'ingest'>
  readonly #lyrics: Pick<LyricsService, 'fetchRemote' | 'writeSidecar'>
  readonly #covers: Pick<CoverService, 'saveFromUrl'>
  readonly #ytdlp: Pick<YtDlpService, 'status' | 'download' | 'probe' | 'probeDuration'>
  readonly #throttle: Pick<YtThrottleService, 'waitMs'>
  readonly #cloud: ImportUploader
  readonly #keepAwake: KeepAwakeService
  readonly #logger: Logger

  /** Abort controllers for in-flight jobs, so cancel can actually stop them. */
  readonly #inFlight = new Map<string, AbortController>()
  /** Library folders handed to imports that have not written their file yet. */
  readonly #claimedFolders = new Set<string>()
  /** The wake-up set while the budget says wait; at most one at a time. */
  #paceTimer: NodeJS.Timeout | null = null
  #activeCount = 0
  #draining = false
  #stopped = false

  /**
   * Each dependency is narrowed to the methods this worker actually calls,
   * the way `cloud` already was. It documents the worker's reach — everything
   * it can do to the rest of the server is on this list — and it lets a test
   * stand in for the parts that would otherwise reach the network or the disk
   * without casting its way around the types.
   */
  constructor(deps: {
    config: Pick<Config, 'dataDir'>
    storage: Pick<StorageDriver, 'write' | 'exists'>
    imports: ImportRepository
    songs: Pick<SongRepository, 'byId' | 'patch' | 'setSourceUrl' | 'setInstrumental'>
    tags: Pick<TagRepository, 'exists' | 'addToSong'>
    playlists: Pick<PlaylistRepository, 'byId' | 'add'>
    settings: Pick<SettingsRepository, 'get'>
    scanner: Pick<ScannerService, 'ingest'>
    lyrics: Pick<LyricsService, 'fetchRemote' | 'writeSidecar'>
    covers: Pick<CoverService, 'saveFromUrl'>
    ytdlp: Pick<YtDlpService, 'status' | 'download' | 'probe' | 'probeDuration'>
    throttle: Pick<YtThrottleService, 'waitMs'>
    cloud: ImportUploader
    keepAwake: KeepAwakeService
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
    this.#throttle = deps.throttle
    this.#cloud = deps.cloud
    this.#keepAwake = deps.keepAwake
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
    if (this.#paceTimer) clearTimeout(this.#paceTimer)
    this.#paceTimer = null
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
    // The database says whether it is too late; only then is the work stopped.
    if (!this.#imports.cancel(jobId)) return false
    this.#inFlight.get(jobId)?.abort()
    this.kick()
    return true
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
      // The budget is a property of the queue, not of any one job: when there
      // is nothing to spend, nothing is claimed and the jobs stay queued. A
      // claimed job holding a slot open while it sleeps would look like work.
      const pacing = this.#throttle.waitMs()
      if (pacing > 0) {
        // One timer however many times this is asked: everything that kicks
        // the queue during a pause would otherwise start a chain of its own.
        // Capped, so a pause lifted by hand is noticed within the minute.
        this.#paceTimer ??= setTimeout(
          () => {
            this.#paceTimer = null
            this.kick()
          },
          Math.min(pacing, 60_000),
        )
        return
      }

      const limit = this.#settings.get().importConcurrency
      while (this.#activeCount < limit && !this.#stopped) {
        const job = this.#imports.claimNext()
        if (!job) break

        this.#activeCount++
        // A download is the server doing real work for someone; do not let the
        // machine idle out from under it halfway through.
        const awake = this.#keepAwake.hold()
        void this.#process(job)
          .catch(error => {
            this.#logger.error('job crashed', {
              jobId: job.id,
              message: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            awake()
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
      this.#cloud.kick()
    } catch (error) {
      if (controller.signal.aborted) {
        this.#imports.update(job.id, { status: 'cancelled', step: 'finished', error: null })
        this.#cloud.kick()
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      const current = this.#imports.byId(job.id)
      const uploading = error instanceof UploadError

      /*
       * Not a failed download: YouTube refused the address for rate.
       *
       * Nothing is wrong with this song, so failing it would be a lie — and on
       * a hundred song import it would be a hundred lies, each needing its own
       * click. The budget is cut, the queue stops for a while, and the job goes
       * back in the queue it never really left.
       */
      if (error instanceof RateLimitedError) {
        // The budget was already cut where the refusal was met (ytdlp.ts);
        // all that is left to do here is not blame the song.
        this.#logger.warn('rate limited; job put back in the queue', { title: job.title })
        this.#imports.update(job.id, { status: 'queued', step: 'waiting', error: null })
        this.#cloud.kick()
        return
      }

      if (uploading) {
        // Not a failed import: the song is in the library here. The cloud
        // sync keeps trying, and marks this job done once the song is up.
        this.#logger.warn('imported, but not uploaded yet', { message, songId: current?.songId })
        this.#imports.update(job.id, {
          status: 'error',
          step: 'uploading',
          error: `Saved on this server, but not uploaded yet: ${message} It will upload by itself once the bucket can be reached.`,
        })
        return
      }

      this.#logger.error('import failed', { message, url: job.url })
      this.#imports.update(job.id, { status: 'error', step: 'finished', error: message })
      this.#cloud.kick()
    }
  }

  async #runJob(job: ImportJob, settings: Settings, signal: AbortSignal): Promise<number> {
    // A job that already added its song and only failed to upload it picks
    // up where it stopped: downloading the song again would be a second copy.
    if (job.songId !== null && this.#songs.byId(job.songId)) {
      await this.#upload(job.id, job.songId)
      return job.songId
    }

    const tools = await this.#ytdlp.status()
    if (!tools.ytdlp) {
      throw new Error('yt-dlp is not installed — run: brew install yt-dlp ffmpeg')
    }

    // Fill in any metadata the client did not already provide.
    let { title, artist, album, duration } = job
    let thumbnail = job.thumbnail

    /*
     * A search page's listing names its songs but not who sings them, so a
     * job from one arrives with a title and no artist. Asked about on its
     * own, the video says: `artist`, `album`, and a thumbnail, for the file's
     * name, the lyrics lookup and the tags the download embeds.
     */
    if (!title.trim() || !artist.trim()) {
      this.#imports.update(job.id, { step: 'resolving' })
      const probed = await this.#ytdlp.probe(job.url, signal, 'patient')
      if (probed.kind === 'playlist') {
        // `--no-playlist` means nothing to an album or playlist address: every
        // song in it would be downloaded, each over the last, into one file.
        throw new Error(
          'that link is a playlist, not one song — paste it on the Import screen to choose its songs',
        )
      }
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

    const name = sanitizeFilename(artist.trim() ? `${artist} - ${title}` : title) || 'untitled'
    const baseName = uniqueBaseName(name, job.id)

    // yt-dlp writes to the real filesystem, so downloads always land in a local
    // staging directory first and are then handed to the storage driver. That
    // is what keeps object storage a drop-in swap.
    const staging = stagingDir(this.#config)
    await fsp.mkdir(staging, { recursive: true })

    /*
     * Clear anything this job left behind last time.
     *
     * A download killed part-way — cancelled, or the server restarted under it
     * — leaves its half-written file here, and `uniqueBaseName` gives the same
     * job the same name on every attempt. Left in place it is in `before`, so
     * the finished file is never recognised as new and the job fails with "no
     * file appeared" for ever, however often it is retried.
     */
    for (const leftover of await safeReaddir(staging)) {
      if (!leftover.startsWith(baseName)) continue
      await fsp.rm(path.join(staging, leftover), { force: true }).catch(() => undefined)
    }

    const before = new Set(await safeReaddir(staging))

    // yt-dlp reports every chunk; a write per whole percent is plenty.
    let shown = 0
    await this.#ytdlp.download({
      url: job.url,
      // `%` starts a field in an output template, so a title containing one —
      // "100%(real)" — would name the file something else entirely and the
      // download would never be found. `%%` is how a template spells a literal.
      outputTemplate: path.join(staging, `${baseName.replaceAll('%', '%%')}.%(ext)s`),
      hasFfmpeg: tools.ffmpeg,
      signal,
      onProgress: percent => {
        const whole = Math.floor(percent)
        if (whole === shown) return
        shown = whole
        this.#imports.update(job.id, { progress: whole })
      },
    })

    const after = await safeReaddir(staging)
    const downloaded = after.find(name => !before.has(name) && name.startsWith(baseName))
    if (!downloaded) throw new Error('the download finished but no file appeared')

    const stagedPath = path.join(staging, downloaded)
    let libraryKey: string | null = null

    try {
      // --- move into the library -------------------------------------------

      // The last moment a cancel can stop this. Past here the song goes into
      // the library, and the queue no longer takes one (ImportRepository.cancel).
      signal.throwIfAborted()
      this.#imports.update(job.id, { step: 'converting', progress: null })

      libraryKey = await this.#claimLibraryKey(name, path.extname(downloaded))

      const data = await fsp.readFile(stagedPath)
      await this.#storage.write(libraryKey, data)

      const realDuration = duration || (await this.#ytdlp.probeDuration(stagedPath))

      // --- lyrics -----------------------------------------------------------

      // There is no song row yet, so an instrumental answer is held until
      // there is one to write it to.
      let instrumental = false
      if (settings.autoFetchLyrics) {
        this.#imports.update(job.id, { step: 'lyrics' })
        const remote = await this.#lyrics.fetchRemote({
          artist,
          title,
          album,
          duration: realDuration,
          sourceUrl: job.url,
        })
        if (remote === 'instrumental') {
          instrumental = true
        } else if (remote) {
          await this.#lyrics
            .writeSidecar(libraryKey, remote.text, remote.synced)
            .catch(() => undefined)
        }
      }

      // --- save -------------------------------------------------------------

      this.#imports.update(job.id, { step: 'saving' })

      const songId = await this.#scanner.ingest(libraryKey)

      // Trust the user's chosen metadata over whatever was in the file tags —
      // where there is some. A blank is nothing chosen, and the tag yt-dlp
      // embedded from YouTube's own listing is better than no artist at all.
      this.#songs.patch(songId, {
        title: title.trim(),
        ...(artist.trim() ? { artist: artist.trim() } : {}),
        ...(album.trim() ? { album: album.trim() } : {}),
      })
      this.#songs.setSourceUrl(songId, job.url)
      if (instrumental) this.#songs.setInstrumental(songId, true)

      /*
       * The listing's art, over what the file carries. yt-dlp embeds the
       * video's still — for a song on YouTube Music, the square art
       * letterboxed on black at 1280×720 — and that stood as the cover: the
       * wrong shape in every list, and mostly black to the colour picking. A
       * square picture from YouTube Music replaces it; anything else is kept
       * only where the file brought none.
       */
      const song = this.#songs.byId(songId)
      if (song && thumbnail && (!song.hasArt || isSquareCoverUrl(thumbnail))) {
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

      await this.#upload(job.id, songId)
      return songId
    } finally {
      await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
      // Written by now, or given up on: either way the disk has the last word.
      if (libraryKey) this.#claimedFolders.delete(path.posix.dirname(libraryKey))
    }
  }

  /**
   * With a bucket connected, the job is done once the song is in it: until
   * then no other device can see it (docs/SYNC.md). The song id is written to
   * the job first, which is what lets a retry skip straight back to here.
   */
  async #upload(jobId: string, songId: number): Promise<void> {
    if (!this.#cloud.connected) return
    this.#imports.update(jobId, { step: 'uploading', progress: null, songId })
    try {
      await this.#cloud.uploadSong(songId)
    } catch (error) {
      throw new UploadError(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * A folder of the song's own in the library — see libraryLayout.ts. Claimed
   * before the disk is checked, so two imports of the same song running at
   * once cannot both be handed the same one.
   */
  async #claimLibraryKey(name: string, extension: string): Promise<string> {
    for (const candidate of songKeyCandidates(name, extension)) {
      const folder = path.posix.dirname(candidate)
      if (this.#claimedFolders.has(folder)) continue
      this.#claimedFolders.add(folder)
      if (await isFreeOnDisk(this.#storage, candidate)) return candidate
      this.#claimedFolders.delete(folder)
    }
    throw new Error('could not find a free name for this song in the library')
  }
}

/**
 * The download's name while it is staged. yt-dlp appends its own suffixes; the
 * job id keeps concurrent jobs apart. It does not follow the song into the
 * library, where the folder does that job.
 */
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
