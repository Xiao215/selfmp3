import path from 'node:path'
import fsp from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { ANALYSIS_VERSION, type AnalysisStatus } from '@selfmp3/shared'
import { stagingDir, type Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { SongRepository } from '../repositories/songs.js'
import type { AudioFeaturesRepository } from '../repositories/audioFeatures.js'
import type { BucketDownloadsRepository } from '../repositories/bucketDownloads.js'
import type { ScannerService } from './scanner.js'
import type { ImportQueueService } from './importQueue.js'
import {
  ANALYSIS_SAMPLE_RATE,
  MOTION_SAMPLE_RATE,
  MotionBuilder,
  type MotionCurveData,
} from './dsp.js'
import { analyzePcmInWorker } from './analysisWorker.js'
import { ffmpegFailure, runFfmpeg } from './ffmpeg.js'
import type { MotionStore } from './motionStore.js'
import type { SoundService } from '../sound/sound.js'
import { messageOf } from '../util/errors.js'

/**
 * Background audio analysis.
 *
 * Every song is decoded once with ffmpeg and run through `dsp.ts` for tempo,
 * key, energy and beat regularity; loudness comes from ffmpeg's own EBU R128
 * meter, which is both cheaper and more accurate than anything worth writing
 * by hand. A third, whole-song decode at a lower rate becomes the song's motion
 * curve (MotionStore), which Now Playing's visuals play back against the
 * playhead where they cannot listen to the music live. Nothing leaves the machine.
 *
 * The queue is the database: a song is "pending" when it has no features row
 * (or one from an older algorithm), so a restart loses nothing and a scan or
 * import only has to nudge the loop. It runs one song at a time and yields to
 * scans and imports — analysis is a nicety, and it should never make the
 * thing you actually asked for slower.
 *
 * The same loop has each song heard by the listening model (sound/): a new
 * song while its file is open for the features anyway, and every song
 * already analysed once nothing else is waiting. A song whose copy is only
 * in the bucket costs a download to analyse or hear, so that backlog is paced
 * by `BUCKET_DOWNLOADS_PER_DAY`, counted across restarts.
 */

/** Analyse this much of the middle of each track: enough for tempo and key. */
const CLIP_SECONDS = 120
/** Skip intros; they are often ambient and unrepresentative. */
const CLIP_OFFSET_SECONDS = 30
/** Only skip the intro when the track is long enough to still leave a clip. */
const MIN_SECONDS_FOR_OFFSET = CLIP_OFFSET_SECONDS + 60

const DECODE_TIMEOUT_MS = 60_000
/** The DSP over a two-minute clip takes well under a second; a worker that hangs gets this. */
const ANALYSE_TIMEOUT_MS = 30_000
/** The folder a fetched song waits in while ffmpeg reads it: `incoming/analyse-XXXXXX/`. */
const TEMP_PREFIX = 'analyse-'
/** The motion curve covers this much of a song at most: a DJ set's first quarter hour. */
const MOTION_MAX_SECONDS = 15 * 60
/** Decoding a whole song takes longer than a clip; still bounded, for a file that hangs ffmpeg. */
const MOTION_TIMEOUT_MS = 180_000
/** Pause between songs, so a big first run does not peg a core for an hour. */
const BREATHER_MS = 250
/** How long to wait before re-checking when a scan or import is busy. */
const BUSY_RETRY_MS = 5_000
/**
 * Songs fetched from the bucket to be analysed or heard, per day (UTC, as
 * Backblaze counts), together. A library of a few thousand is worked through
 * over a few days rather than spending a day's free downloads on it, which is
 * what playing music needs. Only a song whose copy here has gone costs one.
 */
const BUCKET_DOWNLOADS_PER_DAY = 1_000
/**
 * A song the bucket would not give is passed over for now; this many in a
 * row and the bucket itself is not answering (its daily cap, or the network),
 * so the loop waits `BUCKET_RETRY_MS` and tries them all again.
 */
const FETCH_FAILURES_TO_WAIT = 3
const BUCKET_RETRY_MS = 30 * 60_000

/** A song with no audio here and none in the bucket: nothing to analyse or hear. */
class NoAudioError extends Error {}

/**
 * The bucket would not give a song's audio this time — its daily cap, the
 * network. Not the song's fault, so it is not recorded as broken: it is
 * passed over and tried again later.
 */
class NotFetchedError extends Error {}

/** Today's downloads for the loop are spent; it comes back tomorrow. */
class DownloadsSpentError extends Error {}

/** The day as Backblaze counts it: `2026-10-07`, in UTC. */
function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** A song's audio as a path ffmpeg can read, and how to be rid of it afterwards. */
interface LocalFile {
  readonly file: string
  readonly cleanup: () => Promise<void>
}

export class AnalysisService {
  readonly #config: Config
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #audioFeatures: AudioFeaturesRepository
  readonly #motion: MotionStore
  readonly #scanner: ScannerService
  readonly #importQueue: ImportQueueService
  readonly #fetchAudio: (songId: number) => Promise<Buffer | null>
  readonly #sound: SoundService | null
  readonly #downloads: Pick<BucketDownloadsRepository, 'spentOn' | 'spend'>
  readonly #analyzePcm: typeof analyzePcmInWorker
  readonly #logger: Logger
  readonly #onProgress: (done: number, finished: boolean) => void

  #running = false
  #stopped = false
  #retryTimer: NodeJS.Timeout | null = null
  /** A kick that arrived mid-run; the loop checks once more before resting. */
  #kickedWhileRunning = false
  #done = 0
  #failed = 0
  #current: AnalysisStatus['current'] = null
  /** Songs the bucket would not give this time round, and how many failed in a row. */
  readonly #notFetched = new Set<number>()
  #fetchFailures = 0

  constructor(deps: {
    config: Config
    storage: StorageDriver
    songs: SongRepository
    audioFeatures: AudioFeaturesRepository
    motion: MotionStore
    scanner: ScannerService
    importQueue: ImportQueueService
    /**
     * A song's audio from the bucket, for one whose copy here has already gone
     * (services/cloudSync.ts). Null when the bucket has none, or none is
     * connected. Absent where the bucket is not what is being tested.
     */
    fetchAudio?: (songId: number) => Promise<Buffer | null>
    /** The listening model's side; absent where it is not what is being tested. */
    sound?: SoundService
    /** How many songs the loop has downloaded from the bucket today. */
    downloads: Pick<BucketDownloadsRepository, 'spentOn' | 'spend'>
    /**
     * The DSP over a decoded clip: on a worker thread unless a test says
     * otherwise — a worker started from TypeScript source cannot import the
     * rest of it, which is all a test has.
     */
    analyzePcm?: typeof analyzePcmInWorker
    logger: Logger
    /**
     * Called after each song analysed, and once more when a run that analysed
     * any ends. A run that found nothing to do says nothing: every scan and
     * every wake of the listening model ends in one, and each call has every
     * device fetch the library again (and the cloud sync make a pass).
     */
    onProgress: (done: number, finished: boolean) => void
  }) {
    this.#config = deps.config
    this.#storage = deps.storage
    this.#songs = deps.songs
    this.#audioFeatures = deps.audioFeatures
    this.#motion = deps.motion
    this.#scanner = deps.scanner
    this.#importQueue = deps.importQueue
    this.#fetchAudio = deps.fetchAudio ?? (() => Promise.resolve(null))
    this.#sound = deps.sound ?? null
    this.#downloads = deps.downloads
    this.#analyzePcm = deps.analyzePcm ?? analyzePcmInWorker
    this.#logger = deps.logger.child('analysis')
    this.#onProgress = deps.onProgress
  }

  status(): AnalysisStatus {
    return {
      running: this.#running,
      pending: this.#audioFeatures.countPending(ANALYSIS_VERSION),
      done: this.#done,
      failed: this.#failed,
      current: this.#current,
      sound: this.#sound?.status() ?? { state: 'off', heard: 0, pending: 0, message: null },
    }
  }

  /** Ask the loop to look for work. Safe to call as often as you like. */
  kick(): void {
    if (this.#stopped) return
    if (this.#running) {
      this.#kickedWhileRunning = true
      return
    }
    void this.#drain()
  }

  /**
   * (Re)analyse everything. With `force`, existing results are thrown away
   * first — for when the algorithm changes, or the numbers just look wrong.
   */
  start(force = false): AnalysisStatus {
    if (force) {
      this.#audioFeatures.deleteAll()
    }
    this.#done = 0
    this.#failed = 0
    this.kick()
    return this.status()
  }

  /** The file changed underneath a song; its features and its curve are stale. */
  invalidate(songId: number): void {
    this.#audioFeatures.delete(songId)
    this.#sound?.forget(songId)
    void this.#motion.delete(songId)
    this.kick()
  }

  stop(): void {
    this.#stopped = true
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
  }

  #busy(): boolean {
    return this.#scanner.isRunning || this.#importQueue.activeCount > 0
  }

  async #drain(): Promise<void> {
    if (this.#running || this.#stopped) return
    this.#running = true
    let analysed = 0

    try {
      await this.#sweepLeftovers()
      while (!this.#stopped) {
        if (this.#busy()) {
          // Come back once the important work is done. One timer, not one per
          // kick: a scan kicks once per song ingested, and each of those used
          // to leave another timer behind to wake the process for nothing.
          this.#wakeAt(Date.now() + BUSY_RETRY_MS)
          return
        }

        this.#kickedWhileRunning = false
        const songId = this.#audioFeatures.nextPending(ANALYSIS_VERSION, this.#notFetched)
        if (songId === null) {
          // Every song has its tempo and key; what is left is how they sound.
          const heardOne = await this.#hearNext()
          if (!heardOne) break
          continue
        }

        const song = this.#songs.byId(songId)
        if (!song) continue

        this.#current = { id: song.id, title: song.title }
        try {
          await this.#analyze(song.id, song.path, song.duration)
          this.#done++
          analysed++
          this.#current = null
          this.#onProgress(this.#done, false)
        } catch (error) {
          this.#current = null
          if (error instanceof DownloadsSpentError || error instanceof NotFetchedError) {
            if (this.#passOver(song, error)) continue
            break
          }
          this.#failed++
          this.#logger.warn('analysis failed', {
            song: song.title,
            message: messageOf(error),
          })
          // Write an empty row so the loop does not retry the same broken
          // file forever; a forced re-run clears it. A curve from before the
          // file broke would describe some other audio, so it goes.
          await this.#motion.delete(song.id)
          this.#audioFeatures.upsert(song.id, {
            bpm: null,
            energy: null,
            loudnessLufs: null,
            key: null,
            camelot: null,
            danceability: null,
            version: ANALYSIS_VERSION,
          })
          this.#current = null
        }

        await sleep(BREATHER_MS)
      }
    } finally {
      this.#running = false
      this.#current = null
    }

    // Songs passed over and nothing set to come back for them: the listening
    // model, which also comes back for its own, may be off.
    if (this.#notFetched.size > 0 && this.#retryTimer === null) this.#comeBackForPassedOver()

    // Something was added between the last check and now; go again.
    if (this.#kickedWhileRunning) {
      this.kick()
      return
    }

    if (analysed === 0) return
    this.#logger.info('analysis complete', { analysed: this.#done, failed: this.#failed })
    this.#onProgress(this.#done, true)
  }

  /**
   * A song whose audio could not be had from the bucket, passed over for now.
   * Says whether to go on with the next. With the day's downloads spent, yes:
   * a song whose copy is here costs nothing. A bucket that would not give it,
   * a few times in a row, is not answering, and the loop waits instead.
   */
  #passOver(song: { id: number; title: string }, error: Error): boolean {
    this.#notFetched.add(song.id)
    if (error instanceof DownloadsSpentError) return true
    this.#fetchFailures++
    this.#logger.warn('could not fetch a song from the bucket; trying again later', {
      song: song.title,
      message: error.message,
    })
    if (this.#fetchFailures < FETCH_FAILURES_TO_WAIT) return true
    this.#fetchFailures = 0
    this.#comeBackForPassedOver()
    return false
  }

  /**
   * Come back for the songs passed over: a minute into tomorrow (UTC) when
   * the day's downloads are spent, and after `BUCKET_RETRY_MS` otherwise.
   */
  #comeBackForPassedOver(): void {
    const today = utcDay()
    const at =
      this.#downloads.spentOn(today) >= BUCKET_DOWNLOADS_PER_DAY
        ? Date.parse(`${today}T00:00:00Z`) + 86_400_000 + 60_000
        : Date.now() + BUCKET_RETRY_MS
    this.#wakeAt(at, () => this.#notFetched.clear())
  }

  /** Analyse one song and store the result. */
  async #analyze(songId: number, key: string, duration: number): Promise<void> {
    const startedAt = Date.now()
    const { file, cleanup } = await this.#localFile(songId, key)

    try {
      const [pcm, loudness, motion] = await Promise.all([
        decode(file, duration),
        measureLoudness(file),
        timed(measureMotion(file)).catch((error: unknown) => {
          this.#logger.warn('could not make a motion curve', {
            song: key,
            message: messageOf(error),
          })
          return null
        }),
      ])
      // Pure CPU for a few hundred milliseconds, off the thread that answers
      // the phone: a seek that landed during it used to wait for it.
      const features = await this.#analyzePcm(pcm, ANALYSIS_SAMPLE_RATE, ANALYSE_TIMEOUT_MS)

      // The curve before the row: a row at this version is what says the song
      // is done, so a crash between the two re-analyses it rather than
      // leaving it without a curve for good.
      if (motion) await this.#motion.write(songId, motion.value)
      else await this.#motion.delete(songId)

      this.#audioFeatures.upsert(songId, {
        bpm: features.bpm,
        energy: features.energy,
        loudnessLufs: loudness,
        key: features.key,
        camelot: features.camelot,
        danceability: features.danceability,
        version: ANALYSIS_VERSION,
      })

      // Heard now, while the file is here: later it may be in the bucket only,
      // and hearing it then would be a second download. So the model is made
      // ready for it rather than only used if it already was.
      if (this.#sound && !this.#sound.has(songId) && (await this.#sound.prepare())) {
        await this.#hearFile(songId, key, file, duration)
      }

      this.#logger.debug('analysed', {
        song: key,
        bpm: features.bpm,
        key: features.key,
        camelot: features.camelot,
        energy: features.energy,
        lufs: loudness,
        motionFrames: motion?.value.loudness.length ?? null,
        motionMs: motion?.ms ?? null,
        ms: Date.now() - startedAt,
      })
    } finally {
      await cleanup()
    }
  }

  /**
   * One song heard that was waiting for it, after everything else; false when
   * there is none, or none can be heard now. A model that could not be had,
   * or a day's bucket downloads spent, has the loop come back later by itself.
   */
  async #hearNext(): Promise<boolean> {
    const sound = this.#sound
    if (!sound) return false
    if (sound.nextPending(this.#notFetched) === null) {
      // Only songs the bucket would not give are left: they get another try later.
      if (this.#notFetched.size > 0) this.#comeBackForPassedOver()
      return false
    }
    if (!(await sound.prepare())) {
      const at = sound.retryAt
      if (at !== null) this.#wakeAt(at)
      return false
    }

    const songId = sound.nextPending(this.#notFetched)
    if (songId === null) return false
    const song = this.#songs.byId(songId)
    if (!song) {
      sound.markUnhearable(songId)
      return true
    }

    let local: LocalFile
    try {
      local = await this.#localFile(song.id, song.path)
    } catch (error) {
      if (error instanceof NoAudioError) {
        // Nowhere to hear it from: recorded, as a broken file is. A new file
        // for the song is heard again (`invalidate`).
        sound.markUnhearable(song.id)
        return true
      }
      // The bucket did not give it (its daily cap, or the network), or today's
      // downloads are spent. The song is not given up for that: it is passed
      // over for now.
      return this.#passOver(song, error instanceof Error ? error : new Error(messageOf(error)))
    }

    // No onProgress here: a vector changes nothing in the library the devices
    // hold, so hearing does not have them fetch it again.
    this.#current = { id: song.id, title: song.title }
    try {
      await this.#hearFile(song.id, song.path, local.file, song.duration)
    } finally {
      await local.cleanup()
      this.#current = null
    }
    await sleep(BREATHER_MS)
    return true
  }

  /** Hear one song from a file on this disk; a song that cannot be heard is recorded so. */
  async #hearFile(songId: number, key: string, file: string, duration: number): Promise<void> {
    const startedAt = Date.now()
    try {
      await this.#sound!.hear(songId, file, duration)
      this.#logger.debug('heard', { song: key, ms: Date.now() - startedAt })
    } catch (error) {
      this.#logger.warn('could not hear a song', {
        song: key,
        message: messageOf(error),
      })
      this.#sound!.markUnhearable(songId)
    }
  }

  /** Come back to the loop at a time, rather than on the next scan or import. */
  #wakeAt(at: number, first?: () => void): void {
    if (this.#retryTimer) clearTimeout(this.#retryTimer)
    this.#retryTimer = setTimeout(
      () => {
        this.#retryTimer = null
        first?.()
        this.kick()
      },
      Math.max(1_000, at - Date.now()),
    )
    this.#retryTimer.unref()
  }

  /**
   * ffmpeg needs a real path. A song still in the inbox has one; a song whose
   * copy here has gone is fetched from the bucket into the staging directory
   * and removed afterwards — one of the day's `BUCKET_DOWNLOADS_PER_DAY`.
   */
  async #localFile(songId: number, key: string): Promise<LocalFile> {
    if (await this.#storage.exists(key)) {
      return {
        file: this.#storage.localPath(key),
        cleanup: () => Promise.resolve(),
      }
    }

    const today = utcDay()
    if (this.#downloads.spentOn(today) >= BUCKET_DOWNLOADS_PER_DAY) {
      throw new DownloadsSpentError('today’s downloads from the bucket are spent')
    }
    let data: Buffer | null
    try {
      data = await this.#fetchAudio(songId)
    } catch (error) {
      throw new NotFetchedError(messageOf(error))
    }
    if (!data) throw new NoAudioError('no copy of the audio here, and none in the bucket')
    this.#downloads.spend(today)
    this.#fetchFailures = 0

    const staging = stagingDir(this.#config)
    await fsp.mkdir(staging, { recursive: true })
    // A folder of its own, so what a kill leaves behind is one name to sweep.
    const dir = await fsp.mkdtemp(path.join(staging, TEMP_PREFIX))
    const file = path.join(dir, `audio${path.extname(key)}`)
    await fsp.writeFile(file, data)
    return {
      file,
      cleanup: () => fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined),
    }
  }

  /**
   * Once per run, before the first song: whatever a previous run's kill left
   * in the staging folder — a whole song per folder, which adds up.
   */
  #swept = false
  async #sweepLeftovers(): Promise<void> {
    if (this.#swept) return
    this.#swept = true
    const staging = stagingDir(this.#config)
    let names: string[]
    try {
      names = await fsp.readdir(staging)
    } catch {
      return
    }
    await Promise.all(
      names
        .filter(name => name.startsWith(TEMP_PREFIX))
        .map(name =>
          fsp.rm(path.join(staging, name), { recursive: true, force: true }).catch(() => undefined),
        ),
    )
  }
}

/**
 * Decode a clip of the file to mono float PCM at the analysis rate.
 *
 * Streamed from ffmpeg's stdout rather than via a temp file, capped at the
 * clip length so a two-hour DJ set costs the same as a three-minute song.
 */
export async function decode(file: string, duration: number): Promise<Float32Array> {
  const offset = duration >= MIN_SECONDS_FOR_OFFSET ? CLIP_OFFSET_SECONDS : 0
  const maxBytes = CLIP_SECONDS * ANALYSIS_SAMPLE_RATE * 4

  const args = [
    '-v',
    'error',
    '-nostdin',
    ...(offset > 0 ? ['-ss', String(offset)] : []),
    '-t',
    String(CLIP_SECONDS),
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(ANALYSIS_SAMPLE_RATE),
    '-f',
    'f32le',
    '-',
  ]

  const chunks: Buffer[] = []
  let total = 0
  const result = await runFfmpeg(args, {
    timeoutMs: DECODE_TIMEOUT_MS,
    timeoutMessage: 'ffmpeg timed out decoding the file',
    onStdout: chunk => {
      if (total >= maxBytes) return
      chunks.push(chunk)
      total += chunk.length
    },
  })
  if (result.code !== 0 && total === 0) throw ffmpegFailure(result)

  const buffer = Buffer.concat(chunks, total)
  // Float32Array needs 4-byte alignment; a fresh copy guarantees it.
  const aligned = new Float32Array(Math.floor(buffer.length / 4))
  for (let i = 0; i < aligned.length; i++) aligned[i] = buffer.readFloatLE(i * 4)
  return aligned
}

/**
 * The whole song's motion curve, decoded at `MOTION_SAMPLE_RATE` and folded
 * into frames as ffmpeg streams it: memory holds one onset window and the
 * per-frame numbers, not the song. Capped at `MOTION_MAX_SECONDS`.
 */
async function measureMotion(file: string): Promise<MotionCurveData> {
  const args = [
    '-v',
    'error',
    '-nostdin',
    '-t',
    String(MOTION_MAX_SECONDS),
    '-i',
    file,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(MOTION_SAMPLE_RATE),
    '-f',
    'f32le',
    '-',
  ]
  const maxSamples = MOTION_MAX_SECONDS * MOTION_SAMPLE_RATE

  const builder = new MotionBuilder(MOTION_SAMPLE_RATE)
  // A chunk can end mid-sample; the odd bytes wait for the next one.
  let carry = Buffer.alloc(0)
  let samples = 0
  const result = await runFfmpeg(args, {
    timeoutMs: MOTION_TIMEOUT_MS,
    timeoutMessage: 'ffmpeg timed out decoding the whole file',
    onStdout: chunk => {
      if (samples >= maxSamples) return
      const bytes = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      const whole = Math.floor(bytes.length / 4)
      const count = Math.min(whole, maxSamples - samples)
      const pcm = new Float32Array(count)
      for (let i = 0; i < count; i++) pcm[i] = bytes.readFloatLE(i * 4)
      carry = Buffer.from(bytes.subarray(whole * 4))
      samples += count
      builder.push(pcm)
    },
  })
  if (result.code !== 0 && samples === 0) throw ffmpegFailure(result)
  return builder.finish()
}

/**
 * Integrated loudness via ffmpeg's `ebur128` filter.
 *
 * The filter prints a summary block on stderr when the input ends; the line
 * we want looks like `I:         -14.2 LUFS`. Returns null when the file is
 * silent (ffmpeg reports -70 LUFS as the floor) or the filter is unavailable.
 */
function measureLoudness(file: string): Promise<number | null> {
  const args = [
    '-v',
    'info',
    '-nostats',
    '-nostdin',
    '-i',
    file,
    '-vn',
    '-af',
    'ebur128=framelog=quiet',
    '-f',
    'null',
    '-',
  ]

  // The summary is the last thing ffmpeg says, so it is the end of stderr
  // that is kept. A file that cannot be read, or hangs, has no loudness.
  return runFfmpeg(args, {
    timeoutMs: DECODE_TIMEOUT_MS,
    timeoutMessage: 'ffmpeg timed out measuring loudness',
    stderrTail: 64 * 1024,
  }).then(
    result => parseIntegratedLoudness(result.stderr),
    () => null,
  )
}

/** Pull the integrated loudness out of ffmpeg's ebur128 summary. */
export function parseIntegratedLoudness(stderr: string): number | null {
  const matches = [...stderr.matchAll(/^\s*I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/gm)]
  const last = matches[matches.length - 1]?.[1]
  if (last === undefined) return null
  const value = Number(last)
  if (!Number.isFinite(value) || value <= -69) return null
  return Math.round(value * 10) / 10
}

/** A promise's value and how long it took, for the debug log. */
async function timed<T>(promise: Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = Date.now()
  const value = await promise
  return { value, ms: Date.now() - startedAt }
}
