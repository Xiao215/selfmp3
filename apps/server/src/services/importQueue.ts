import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import {
  messageOf,
  isSquareCoverUrl,
  musicCredits,
  releaseOf,
  sanitizeFilename,
  type ImportDeviceFileMeta,
  type ImportFailure,
  type ImportJob,
  type ImportStep,
  type Settings,
} from '@selfmp3/shared'
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
import { asksYouTube, toProbedTrack, type YtDlpService } from './ytdlp.js'
import type { FileTags, TagWriter } from './tagWriter.js'
import { RateLimitedError, type YtThrottleService } from './ytThrottle.js'
import { METRIC, failureOf, type ServerMetrics, type TimedStep } from './metrics.js'
import { isFreeName, songKeyCandidates } from './libraryLayout.js'

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
  /** Put the song in the bucket and publish a snapshot that has it — later, while `more` are coming. */
  uploadSong(songId: number, options?: { more?: boolean }): Promise<void>
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
  readonly #songs: Pick<
    SongRepository,
    'byId' | 'patch' | 'setSourceUrl' | 'setCameWith' | 'setInstrumental' | 'hasFolder'
  >
  readonly #tags: Pick<TagRepository, 'exists' | 'addToSong'>
  readonly #playlists: Pick<PlaylistRepository, 'byId' | 'add'>
  readonly #settings: Pick<SettingsRepository, 'get'>
  readonly #scanner: Pick<ScannerService, 'ingest'>
  readonly #lyrics: Pick<LyricsService, 'fetchRemote' | 'writeSidecar'>
  readonly #covers: Pick<CoverService, 'saveFromUrl'>
  readonly #ytdlp: Pick<YtDlpService, 'status' | 'download' | 'probe' | 'probeDuration'>
  readonly #throttle: Pick<YtThrottleService, 'waitMs' | 'tryTake'>
  readonly #cloud: ImportUploader
  readonly #keepAwake: KeepAwakeService
  readonly #tagWriter: Pick<TagWriter, 'write'>
  readonly #metrics: Pick<ServerMetrics, 'recordImport' | 'count'>
  readonly #logger: Logger

  /** How long each in-flight job has spent in each step, for the admin page (metrics.ts). */
  readonly #clocks = new Map<string, StepClock>()
  /** Abort controllers for in-flight jobs, so cancel can actually stop them. */
  readonly #inFlight = new Map<string, AbortController>()
  /** Library folders handed to imports that have not written their file yet. */
  readonly #claimedFolders = new Set<string>()
  /** The wake-up set while the budget says wait; at most one at a time. */
  #paceTimer: NodeJS.Timeout | null = null
  /** The wake-up set for when a device's lease runs out; at most one at a time. */
  #leaseTimer: NodeJS.Timeout | null = null
  #activeCount = 0
  /**
   * Files devices sent, checked and waiting for a turn among the jobs in
   * flight: a device's song counts against `importConcurrency` as the
   * server's own downloads do, so several devices sending at once cannot run
   * more than the machine was told to (a Pi, often).
   */
  readonly #deviceFiles: { job: ImportJob; work: JobWork; file: string }[] = []
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
    songs: Pick<
      SongRepository,
      'byId' | 'patch' | 'setSourceUrl' | 'setCameWith' | 'setInstrumental' | 'hasFolder'
    >
    tags: Pick<TagRepository, 'exists' | 'addToSong'>
    playlists: Pick<PlaylistRepository, 'byId' | 'add'>
    settings: Pick<SettingsRepository, 'get'>
    scanner: Pick<ScannerService, 'ingest'>
    lyrics: Pick<LyricsService, 'fetchRemote' | 'writeSidecar'>
    covers: Pick<CoverService, 'saveFromUrl'>
    ytdlp: Pick<YtDlpService, 'status' | 'download' | 'probe' | 'probeDuration'>
    throttle: Pick<YtThrottleService, 'waitMs' | 'tryTake'>
    cloud: ImportUploader
    keepAwake: KeepAwakeService
    tagWriter: Pick<TagWriter, 'write'>
    metrics: Pick<ServerMetrics, 'recordImport' | 'count'>
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
    this.#tagWriter = deps.tagWriter
    this.#metrics = deps.metrics
    this.#logger = deps.logger.child('import')
  }

  /** Called once at boot: requeue anything a crash left mid-flight. */
  start(): void {
    // A device's file still waiting when the server last stopped: its job is the server's again.
    void sweepDeviceFiles(stagingDir(this.#config))
    const orphaned = this.#imports.resetOrphaned()
    if (orphaned > 0) this.#logger.info('requeued interrupted jobs', { count: orphaned })
    this.#imports.pruneOlderThanDays(KEEP_FINISHED_JOBS_DAYS)
    this.kick()
  }

  stop(): void {
    this.#stopped = true
    if (this.#paceTimer) clearTimeout(this.#paceTimer)
    this.#paceTimer = null
    if (this.#leaseTimer) clearTimeout(this.#leaseTimer)
    this.#leaseTimer = null
    for (const controller of this.#inFlight.values()) controller.abort()
    this.#inFlight.clear()
    // A device's file still waiting its turn: the song goes back in the queue, as one stopped mid-way does.
    for (const { job, file } of this.#deviceFiles.splice(0)) {
      this.#imports.update(job.id, { status: 'queued', step: 'waiting', error: null })
      void fsp.rm(file, { force: true }).catch(() => undefined)
    }
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
    this.#dropCalledOff()
    this.kick()
    return true
  }

  /**
   * Take a job off the queue for good: a waiting one goes, a downloading one
   * is stopped and goes, a failed or paused one goes. A job past its
   * download is adding its song and is refused, as a cancel is. Not a
   * cancel: that leaves a "Cancelled" row, which Resume all picks up again.
   */
  remove(jobId: string): boolean {
    if (this.#imports.cancel(jobId)) this.#inFlight.get(jobId)?.abort()
    const removed = this.#imports.dismiss(jobId)
    this.#dropCalledOff()
    if (removed) this.kick()
    return removed
  }

  retry(jobId: string): boolean {
    const retried = this.#imports.retry(jobId)
    if (retried) this.kick()
    return retried
  }

  /**
   * Import next: the song goes to the front of the waiting line (a paused
   * one is resumed there). Nothing downloading is stopped for it; it is
   * simply the next one the loop takes.
   */
  importNext(jobId: string): boolean {
    const moved = this.#imports.importNext(jobId)
    if (moved) this.kick()
    return moved
  }

  /** Pause all: every download that can still be stopped is, and the queue behind it waits. */
  pause(): number {
    const cancelled = this.#imports.cancelAll()
    for (const jobId of cancelled) this.#inFlight.get(jobId)?.abort()
    this.#dropCalledOff()
    return cancelled.length
  }

  /** Resume all: what was paused goes back in the queue and the worker is woken. */
  resume(): number {
    const resumed = this.#imports.retryCancelled()
    if (resumed > 0) this.kick()
    return resumed
  }

  /**
   * Retry all: what failed goes back in the queue. A song that failed for a
   * reason worth reading will fail the same way again, and its row says so
   * again; what failed because the connection dropped for a minute comes in.
   */
  retryFailed(): number {
    const retried = this.#imports.retryFailed()
    if (retried > 0) this.kick()
    return retried
  }

  /** Remove all failed: nothing is in flight among them, so nothing is stopped. */
  removeFailed(): number {
    return this.#imports.dismissFailed()
  }

  // --- Jobs a device downloads (docs/features/client-download.md) -------------

  /** Keep a device's lease, with how far its downloads have got; the jobs it still holds. */
  deviceRenew(
    lease: string,
    progress: readonly { id: string; percent: number }[],
    holding?: readonly string[],
  ): string[] {
    const held = this.#imports.renewLease(lease, DEVICE_LEASE_SECONDS, progress, holding)
    // A job the device has let go of (`holding`) is the queue's now, and it may be idle.
    if (holding) this.kick()
    return held
  }

  /** The device has started downloading one of its jobs. */
  deviceStart(lease: string, id: string): boolean {
    return this.#imports.startOnDevice(lease, id, DEVICE_LEASE_SECONDS)
  }

  /** The device could not download it: the server does, as it would any other. */
  deviceRelease(lease: string, id: string, reason: string): boolean {
    const released = this.#imports.releaseFromDevice(lease, id)
    if (released) {
      this.#logger.info('a device let a job go to the server', { jobId: id, reason })
      this.kick()
    }
    return released
  }

  /**
   * A file a device downloaded for a job it holds: checked, then finished
   * here exactly as a download of the server's own would be, from the step
   * after the download — with the tags yt-dlp would have written, written
   * here instead (tagWriter.ts).
   *
   * The checks are what make the file the song. Its bytes are the ones the
   * device said (`sha256`), there are at most `maxBytes` of them, and ffprobe
   * finds audio in them as long as the song the job is for; a file that fails
   * one is refused and never reaches the library. Only once it passes does the
   * job leave the device — so a refused file leaves the device holding the
   * job, free to let it go to the server.
   */
  async receiveDeviceFile(input: {
    jobId: string
    lease: string
    body: Readable
    sha256: string
    maxBytes: number
    meta: ImportDeviceFileMeta
  }): Promise<DeviceFileOutcome> {
    const job = this.#imports.byId(input.jobId)
    const held = this.#imports.fetcherOf(input.jobId)
    if (!job || held?.lease !== input.lease) {
      input.body.resume()
      return { ok: false, status: 409, message: 'that job is not this device’s to download' }
    }

    const staging = stagingDir(this.#config)
    await fsp.mkdir(staging, { recursive: true })
    // A name of its own per upload: two for one job must not write over each other.
    const stagedPath = path.join(staging, `device-${job.id}-${crypto.randomUUID().slice(0, 8)}.m4a`)
    let taken = false
    try {
      const received = await receive(input.body, stagedPath, input.maxBytes)
      if (received.tooBig) {
        return { ok: false, status: 413, message: 'that file is larger than any song' }
      }
      if (received.sha256 !== input.sha256.toLowerCase()) {
        return { ok: false, status: 400, message: 'the file is not the one its hash names' }
      }

      const seconds = await this.#ytdlp.probeDuration(stagedPath)
      if (!(seconds > 0)) {
        return { ok: false, status: 422, message: 'there is no audio in that file' }
      }
      // The video's own length first: a listing's (a Spotify row's, say) may be another cut's.
      const expected = input.meta.durationSeconds || job.duration
      if (expected > 0 && Math.abs(seconds - expected) > Math.max(3, expected * 0.03)) {
        return {
          ok: false,
          status: 422,
          message: `the file is ${Math.round(seconds)} seconds long, and the song ${Math.round(expected)}`,
        }
      }

      const claimed = this.#imports.takeFromDevice(input.lease, input.jobId)
      if (!claimed) {
        return { ok: false, status: 409, message: 'that job is no longer this device’s' }
      }
      taken = true
      this.#deviceFiles.push({
        job: claimed,
        file: stagedPath,
        work: (signal, settings) =>
          this.#fromDevice(claimed, settings, signal, stagedPath, input.meta, seconds),
      })
      this.kick()
      return { ok: true }
    } finally {
      // Until the job is taken, the file is nobody's; after, it is the job's to remove.
      if (!taken) await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    }
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
      // What a device stopped answering for goes back in the queue first.
      this.#imports.expireLeases()
      const limit = this.#settings.get().importConcurrency
      // A device's file first: it is downloaded already, and only needs its turn.
      this.#dropCalledOff()
      while (this.#activeCount < limit && !this.#stopped) {
        const staged = this.#deviceFiles.shift()
        if (!staged) break
        // Its turn: from here it is being added, and no longer called off (CANCELLABLE).
        this.#imports.update(staged.job.id, { step: 'converting' })
        this.#start({ ...staged.job, step: 'converting' }, staged.work)
      }
      while (this.#activeCount < limit && !this.#stopped) {
        const next = this.#imports.nextQueued()
        if (!next) break
        /*
         * A job is claimed with its turn at YouTube already taken, and not
         * before. The budget is a property of the queue, not of any one job:
         * a job claimed first and paced inside its download sat at
         * "Downloading · 0 %" for the whole wait — most of a minute, signed
         * out — with nothing downloading, while the job it was waiting behind
         * finished. Unclaimed, it waits in the queue as what it is, and the
         * screen counts its turn down from the queue's pacing. A person
         * pasting a link while this runs borrows from the same bucket
         * (PERSON_MAY_BORROW), and the queue waits that much longer. A job
         * that only has its upload left asks YouTube nothing, and goes, as
         * does a song from 网易云.
         */
        const paced = next.songId === null && asksYouTube(next.url)
        if (paced && !this.#throttle.tryTake()) {
          // One timer however many times this is asked: everything that kicks
          // the queue during a pause would otherwise start a chain of its own.
          // Capped, so a pause lifted by hand is noticed within the minute.
          this.#paceTimer ??= setTimeout(
            () => {
              this.#paceTimer = null
              this.kick()
            },
            Math.min(Math.max(this.#throttle.waitMs(), 50), 60_000),
          )
          break
        }
        // Nothing else runs between the look above and this: it is the same job.
        const job = this.#imports.claimNext()
        if (!job) break

        this.#start(job, (signal, settings) => this.#runJob(job, settings, signal, paced))
      }
      this.#watchLeases()
    } finally {
      this.#draining = false
    }
  }

  /**
   * One wake-up for when the soonest lease a device holds runs out, so a job
   * it stopped answering for is taken without waiting for anything else to
   * kick the queue. Capped at a minute, like the pacing's.
   */
  #watchLeases(): void {
    if (this.#leaseTimer || this.#stopped) return
    const end = this.#imports.nextLeaseEnd()
    if (end === null) return
    this.#leaseTimer = setTimeout(
      () => {
        this.#leaseTimer = null
        this.kick()
      },
      Math.min(Math.max(end - Date.now() + 1000, 1000), 60_000),
    )
  }

  /**
   * A device's file whose job was called off while it waited for its turn —
   * cancelled, paused or removed: the job stays as the person left it, and
   * the file goes.
   */
  #dropCalledOff(): void {
    for (let index = this.#deviceFiles.length - 1; index >= 0; index--) {
      const staged = this.#deviceFiles[index]
      if (!staged) continue
      const now = this.#imports.byId(staged.job.id)
      if (now?.status === 'running' && now.step === 'waiting') continue
      this.#deviceFiles.splice(index, 1)
      void fsp.rm(staged.file, { force: true }).catch(() => undefined)
    }
  }

  /** Run a claimed job's `work` in the background, as one of the jobs in flight. */
  #start(job: ImportJob, work: JobWork): void {
    this.#activeCount++
    // A download is the server doing real work for someone; do not let the
    // machine idle out from under it halfway through.
    const awake = this.#keepAwake.hold()
    void this.#process(job, work)
      .catch(error => {
        this.#logger.error('job crashed', {
          jobId: job.id,
          message: messageOf(error),
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

  async #process(job: ImportJob, work: JobWork): Promise<void> {
    const controller = new AbortController()
    this.#inFlight.set(job.id, controller)
    const clock = new StepClock(job)
    this.#clocks.set(job.id, clock)
    const settings = this.#settings.get()

    this.#logger.info('importing', { title: job.title || job.url, attempt: job.attempts })

    try {
      const songId = await work(controller.signal, settings)
      this.#update(job.id, {
        status: 'done',
        step: 'finished',
        progress: 100,
        songId,
        error: null,
      })
      this.#finished(job, clock, null)
      this.#logger.info('imported', { songId, title: job.title })
      // A pass per song of a run was a listing per song; the run's last song kicks.
      if (this.#imports.counts().queued === 0) this.#cloud.kick()
    } catch (error) {
      if (controller.signal.aborted) {
        // Stopped by a shutdown, not by a person: the job goes back in the
        // queue, and the next boot's `resetOrphaned` picks it up where a
        // cancelled one would stay cancelled for good.
        if (this.#stopped) {
          this.#update(job.id, { status: 'queued', step: 'waiting', error: null })
          return
        }
        this.#update(job.id, { status: 'cancelled', step: 'finished', error: null })
        this.#cloud.kick()
        return
      }

      const message = messageOf(error)
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
        this.#metrics.count(METRIC.youtubeHeld)
        this.#update(job.id, { status: 'queued', step: 'waiting', error: null })
        this.#cloud.kick()
        return
      }

      if (uploading) {
        // Not a failed import: the song is in the library here. The cloud
        // sync is woken so its next pass tries the song again — and again,
        // later each time, until the bucket takes it (cloudSync.ts) — and
        // marks this job done once the song is up.
        this.#logger.warn('imported, but not uploaded yet', { message, songId: current?.songId })
        this.#finished(job, clock, 'bucket')
        this.#update(job.id, {
          status: 'error',
          step: 'uploading',
          error: `Saved on this server, but not uploaded yet: ${message} It will upload by itself once the bucket can be reached.`,
        })
        this.#cloud.kick()
        return
      }

      const detail = error instanceof Error && typeof error.cause === 'string' ? error.cause : null
      this.#logger.error('import failed', {
        message,
        url: job.url,
        ...(detail !== null && detail !== message ? { detail } : {}),
      })
      this.#update(job.id, { status: 'error', step: 'finished', error: message })
      this.#finished(job, clock, failureOf(message))
      this.#cloud.kick()
    } finally {
      this.#clocks.delete(job.id)
    }
  }

  /** The job's row, changed; a step it moves to starts that step's clock. */
  #update(jobId: string, changes: Parameters<ImportRepository['update']>[1]): void {
    this.#imports.update(jobId, changes)
    if (changes.step !== undefined) this.#clocks.get(jobId)?.moveTo(changes.step)
  }

  /** Into the import log: worked when `failure` is null. */
  #finished(job: ImportJob, clock: StepClock, failure: ImportFailure | null): void {
    clock.moveTo('finished')
    this.#metrics.recordImport({
      finishedAt: new Date(),
      url: job.url,
      worked: failure === null,
      failure,
      steps: clock.steps,
      attempts: job.attempts,
    })
  }

  async #runJob(
    job: ImportJob,
    settings: Settings,
    signal: AbortSignal,
    paid: boolean,
  ): Promise<number> {
    // The turn taken at the claim pays for the first request, and only that one.
    let turn = paid
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
      this.#update(job.id, { step: 'resolving' })
      const probed = await this.#ytdlp.probe(job.url, signal, turn ? 'paid' : 'patient')
      turn = false
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
        this.#update(job.id, { title, artist, album, duration })
      }
    }

    if (!title.trim()) throw new Error('could not work out a title for this track')

    // --- download -----------------------------------------------------------

    this.#update(job.id, { step: 'downloading', progress: 0 })

    const name = sanitizeFilename(artist.trim() ? `${artist} - ${title}` : title) || 'untitled'
    const baseName = uniqueBaseName(name, job.id)

    // Downloads land in a staging directory first and are handed to the
    // library folder only once yt-dlp has finished with them.
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
      paid: turn,
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
        this.#update(job.id, { progress: whole })
      },
    })

    const after = await safeReaddir(staging)
    const downloaded = after.find(name => !before.has(name) && name.startsWith(baseName))
    if (!downloaded) throw new Error('the download finished but no file appeared')

    return this.#addToLibrary(job, settings, signal, {
      stagedPath: path.join(staging, downloaded),
      name,
      title,
      artist,
      album,
      duration,
      thumbnail,
      tags: null,
    })
  }

  /**
   * A file a device downloaded, made a song: the job's title and artist where
   * the review gave them, the player's where it did not, and the tags yt-dlp
   * would have written, written here (tagWriter.ts). `seconds` is the file's
   * own length, which `receiveDeviceFile` has already measured.
   */
  async #fromDevice(
    job: ImportJob,
    settings: Settings,
    signal: AbortSignal,
    stagedPath: string,
    meta: ImportDeviceFileMeta,
    seconds: number,
  ): Promise<number> {
    let handedOver = false
    try {
      // The same tidying the server gives a video's own title and channel, and
      // a YouTube Music track's credits, as yt-dlp reads them from its description.
      const credits = musicCredits(meta.description)
      const probed = toProbedTrack(
        {
          title: meta.title,
          uploader: meta.author,
          duration: meta.durationSeconds,
          ...(credits
            ? { track: credits.track, artist: credits.artist, album: credits.album }
            : {}),
        },
        job.url,
      )
      const title = job.title.trim() || probed.title
      const artist = job.artist.trim() || probed.artist
      const album = job.album.trim() || probed.album
      if (!title.trim()) throw new Error('could not work out a title for this track')
      if (title !== job.title || artist !== job.artist || album !== job.album) {
        this.#update(job.id, { title, artist, album })
      }

      const release = releaseOf(meta.description)
      const tools = await this.#ytdlp.status()
      handedOver = true
      return await this.#addToLibrary(job, settings, signal, {
        stagedPath,
        name: sanitizeFilename(artist.trim() ? `${artist} - ${title}` : title) || 'untitled',
        title,
        artist,
        album,
        duration: job.duration || seconds,
        // A job with no cover of its own (a search's row, say) takes the video's.
        thumbnail: job.thumbnail ?? meta.thumbnail,
        // Tagging needs ffmpeg, as yt-dlp's does; without it the file goes as it came.
        tags: tools.ffmpeg
          ? {
              title: title.trim(),
              artist: artist.trim(),
              album: album.trim(),
              date: release.date ?? (release.year ? String(release.year) : null),
            }
          : null,
      })
    } finally {
      // Past the hand-over the file is #addToLibrary's to remove; before it, nobody else will.
      if (!handedOver) await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
    }
  }

  /**
   * Everything after the download, for a file from yt-dlp or from a device:
   * into the library, lyrics, the song's row, its cover, tags and playlist,
   * and up to the bucket. `tags`, when given, is written into the file first;
   * yt-dlp's downloads come tagged already.
   */
  async #addToLibrary(
    job: ImportJob,
    settings: Settings,
    signal: AbortSignal,
    file: StagedFile,
  ): Promise<number> {
    const { stagedPath, name, title, artist, album, duration, thumbnail } = file
    let libraryKey: string | null = null

    try {
      await this.#wholeSong(job.url, stagedPath, duration)

      // --- move into the library -------------------------------------------

      // The last moment a cancel can stop this. Past here the song goes into
      // the library, and the queue no longer takes one (ImportRepository.cancel).
      signal.throwIfAborted()
      this.#update(job.id, { step: 'converting', progress: null })

      if (file.tags) await this.#tagWriter.write(stagedPath, file.tags, thumbnail)

      libraryKey = await this.#claimLibraryKey(name, path.extname(stagedPath))

      await this.#storage.write(libraryKey, fs.createReadStream(stagedPath))

      const realDuration = duration || (await this.#ytdlp.probeDuration(stagedPath))

      // --- lyrics -----------------------------------------------------------

      // There is no song row yet, so an instrumental answer is held until
      // there is one to write it to.
      let instrumental = false
      if (settings.autoFetchLyrics) {
        this.#update(job.id, { step: 'lyrics' })
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

      this.#update(job.id, { step: 'saving' })

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
      this.#songs.setCameWith(songId, this.#imports.cameWithFor(job.id))
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

      for (const tagId of this.#tags.exists([...new Set(job.tagIds)])) {
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
   * A song from 网易云 is the whole song, not the preview it gives out for a
   * VIP song: thirty to forty-five seconds, which yt-dlp downloads as the
   * song without complaint. The review sends such a song to YouTube before
   * anything is downloaded (netease.ts), but what 网易云 gives out can change
   * between the review and the download, and a preview kept as the song is
   * worse than a failure that says so.
   */
  async #wholeSong(url: string, file: string, expected: number): Promise<void> {
    if (asksYouTube(url) || expected < PREVIEW_CHECK_FROM_S) return
    const length = await this.#ytdlp.probeDuration(file)
    if (length > 0 && length < expected * WHOLE_SONG_SHARE) {
      throw new Error(
        `网易云 gave only a ${Math.round(length)}-second preview of this song, so it was not imported. Look it up again to get it from YouTube.`,
      )
    }
  }

  /**
   * With a bucket connected, the job is done once the song is in it: until
   * then no other device can see it (docs/SYNC.md). The song id is written to
   * the job first, which is what lets a retry skip straight back to here.
   */
  async #upload(jobId: string, songId: number): Promise<void> {
    if (!this.#cloud.connected) return
    this.#update(jobId, { step: 'uploading', progress: null, songId })
    try {
      await this.#cloud.uploadSong(songId, { more: this.#imports.counts().queued > 0 })
    } catch (error) {
      throw new UploadError(messageOf(error))
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
      let free = false
      try {
        free = await isFreeName(this.#songs, this.#storage, candidate)
      } finally {
        if (!free) this.#claimedFolders.delete(folder)
      }
      if (free) return candidate
    }
    throw new Error('could not find a free name for this song in the library')
  }
}

/** What a job does once claimed, given its stop signal and the settings it started under. */
type JobWork = (signal: AbortSignal, settings: Settings) => Promise<number>

/** A downloaded file waiting in staging, and what the song it becomes is called. */
interface StagedFile {
  readonly stagedPath: string
  /** The library folder's name for it: `Artist - Title`, made safe. */
  readonly name: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
  readonly thumbnail: string | null
  /** Tags to write into the file before it goes in, or null when it has them already. */
  readonly tags: FileTags | null
}

/** What became of a device's file: taken, or refused with an HTTP status and why. */
type DeviceFileOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 400 | 409 | 413 | 422; readonly message: string }

/**
 * How long a device's hold on its jobs lasts unrenewed. Five minutes, not
 * one: a browser tab in the background has its timers slowed to once a
 * minute, and a lease that ran out under a tab someone switched away from
 * would hand its song to the server halfway through the device's download.
 */
export const DEVICE_LEASE_SECONDS = 300

/**
 * Write `body` to `file`, hashing it on the way: its SHA-256, hex — or `tooBig`
 * once more than `maxBytes` have come, and the rest is not read.
 */
async function receive(
  body: Readable,
  file: string,
  maxBytes: number,
): Promise<{ tooBig: true } | { tooBig: false; sha256: string }> {
  const hash = crypto.createHash('sha256')
  let size = 0
  let tooBig = false
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      if (size > maxBytes) {
        tooBig = true
        done(new Error('too big'))
        return
      }
      hash.update(chunk)
      done(null, chunk)
    },
  })
  try {
    await pipeline(body, counted, fs.createWriteStream(file))
  } catch (error) {
    if (tooBig) return { tooBig: true }
    throw error
  }
  return { tooBig: false, sha256: hash.digest('hex') }
}

/** Finished jobs older than this are cleared from the queue's history at boot. */
const KEEP_FINISHED_JOBS_DAYS = 30

/** A song shorter than this cannot be told from its preview by length, and is not checked. */
const PREVIEW_CHECK_FROM_S = 60
/** Less of the song than this, and the file is a preview. */
const WHOLE_SONG_SHARE = 0.8

/**
 * The download's name while it is staged. yt-dlp appends its own suffixes; the
 * job id keeps concurrent jobs apart. It does not follow the song into the
 * library, where the folder does that job.
 */
function uniqueBaseName(base: string, jobId: string): string {
  return `${base} [${jobId.slice(0, 8)}]`
}

/**
 * Remove what devices left in staging (`device-…`): kept only in memory while
 * they wait (`#deviceFiles`), so after a restart nothing will add them.
 */
async function sweepDeviceFiles(staging: string): Promise<void> {
  for (const name of await safeReaddir(staging)) {
    if (name.startsWith('device-')) {
      await fsp.rm(path.join(staging, name), { force: true }).catch(() => undefined)
    }
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir)
  } catch {
    return []
  }
}

/**
 * Where an import's time goes, step by step. Its wait in the queue counts
 * only on a job's first go: a job tried again days later did not wait days.
 */
class StepClock {
  readonly steps: Partial<Record<TimedStep, number>> = {}
  #step: ImportStep
  #at: number

  constructor(job: Pick<ImportJob, 'createdAt' | 'attempts' | 'step'>, now = Date.now()) {
    const created = Date.parse(
      job.createdAt.includes('T') ? job.createdAt : `${job.createdAt.replace(' ', 'T')}Z`,
    )
    if (job.attempts <= 1 && Number.isFinite(created))
      this.steps.waiting = Math.max(0, now - created)
    this.#step = job.step
    this.#at = now
  }

  moveTo(step: ImportStep, now = Date.now()): void {
    if (step === this.#step) return
    if (this.#step !== 'finished') {
      this.steps[this.#step] = (this.steps[this.#step] ?? 0) + Math.max(0, now - this.#at)
    }
    this.#step = step
    this.#at = now
  }
}
