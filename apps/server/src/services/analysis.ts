import path from 'node:path'
import fsp from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { FEATURES_VERSION, type AnalysisStatus } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from '../storage/index.js'
import type { SongRepository } from '../repositories/songs.js'
import type { FeaturesRepository } from '../repositories/features.js'
import type { ScannerService } from './scanner.js'
import type { ImportQueueService } from './importQueue.js'
import { ANALYSIS_SAMPLE_RATE, analyzePcm } from './dsp.js'

/**
 * Background audio analysis.
 *
 * Every song is decoded once with ffmpeg and run through `dsp.ts` for tempo,
 * key, energy and beat regularity; loudness comes from ffmpeg's own EBU R128
 * meter, which is both cheaper and more accurate than anything worth writing
 * by hand. Nothing leaves the machine.
 *
 * The queue is the database: a song is "pending" when it has no features row
 * (or one from an older algorithm), so a restart loses nothing and a scan or
 * import only has to nudge the loop. It runs one song at a time and yields to
 * scans and imports — analysis is a nicety, and it should never make the
 * thing you actually asked for slower.
 */

/** Analyse this much of the middle of each track: enough for tempo and key. */
const CLIP_SECONDS = 120
/** Skip intros; they are often ambient and unrepresentative. */
const CLIP_OFFSET_SECONDS = 30
/** Only skip the intro when the track is long enough to still leave a clip. */
const MIN_SECONDS_FOR_OFFSET = CLIP_OFFSET_SECONDS + 60

const DECODE_TIMEOUT_MS = 60_000
/** Pause between songs, so a big first run does not peg a core for an hour. */
const BREATHER_MS = 250
/** How long to wait before re-checking when a scan or import is busy. */
const BUSY_RETRY_MS = 5_000

export class AnalysisService {
  readonly #config: Config
  readonly #storage: StorageDriver
  readonly #songs: SongRepository
  readonly #features: FeaturesRepository
  readonly #scanner: ScannerService
  readonly #importQueue: ImportQueueService
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

  constructor(deps: {
    config: Config
    storage: StorageDriver
    songs: SongRepository
    features: FeaturesRepository
    scanner: ScannerService
    importQueue: ImportQueueService
    logger: Logger
    /** Called after each song, and once more when the queue drains. */
    onProgress: (done: number, finished: boolean) => void
  }) {
    this.#config = deps.config
    this.#storage = deps.storage
    this.#songs = deps.songs
    this.#features = deps.features
    this.#scanner = deps.scanner
    this.#importQueue = deps.importQueue
    this.#logger = deps.logger.child('analysis')
    this.#onProgress = deps.onProgress
  }

  status(): AnalysisStatus {
    return {
      running: this.#running,
      pending: this.#features.countPending(FEATURES_VERSION),
      done: this.#done,
      failed: this.#failed,
      current: this.#current,
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
      this.#features.deleteAll()
    }
    this.#done = 0
    this.#failed = 0
    this.kick()
    return this.status()
  }

  /** The file changed underneath a song; its features are stale. */
  invalidate(songId: number): void {
    this.#features.delete(songId)
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

    try {
      while (!this.#stopped) {
        if (this.#busy()) {
          // Come back once the important work is done. One timer, not one per
          // kick: a scan kicks once per song ingested, and each of those used
          // to leave another timer behind to wake the process for nothing.
          if (this.#retryTimer) clearTimeout(this.#retryTimer)
          this.#retryTimer = setTimeout(() => this.kick(), BUSY_RETRY_MS)
          return
        }

        this.#kickedWhileRunning = false
        const songId = this.#features.nextPending(FEATURES_VERSION)
        if (songId === null) break

        const song = this.#songs.byId(songId)
        if (!song) continue

        this.#current = { id: song.id, title: song.title }
        try {
          await this.analyze(song.id, song.path, song.duration)
          this.#done++
        } catch (error) {
          this.#failed++
          this.#logger.warn('analysis failed', {
            song: song.title,
            message: error instanceof Error ? error.message : String(error),
          })
          // Write an empty row so the loop does not retry the same broken
          // file forever; a forced re-run clears it.
          this.#features.upsert(song.id, {
            bpm: null,
            energy: null,
            loudnessLufs: null,
            key: null,
            camelot: null,
            danceability: null,
            version: FEATURES_VERSION,
          })
        }
        this.#current = null
        this.#onProgress(this.#done, false)

        await sleep(BREATHER_MS)
      }
    } finally {
      this.#running = false
      this.#current = null
    }

    // Something was added between the last check and now; go again.
    if (this.#kickedWhileRunning) {
      this.kick()
      return
    }

    if (this.#done > 0) {
      this.#logger.info('analysis complete', { analysed: this.#done, failed: this.#failed })
    }
    this.#onProgress(this.#done, true)
  }

  /** Analyse one song and store the result. Exposed for the tests and the route. */
  async analyze(songId: number, key: string, duration: number): Promise<void> {
    const startedAt = Date.now()
    const { file, cleanup } = await this.#localFile(key)

    try {
      const [pcm, loudness] = await Promise.all([decode(file, duration), measureLoudness(file)])
      const features = analyzePcm(pcm, ANALYSIS_SAMPLE_RATE)

      this.#features.upsert(songId, {
        bpm: features.bpm,
        energy: features.energy,
        loudnessLufs: loudness,
        key: features.key,
        camelot: features.camelot,
        danceability: features.danceability,
        version: FEATURES_VERSION,
      })

      this.#logger.debug('analysed', {
        song: key,
        bpm: features.bpm,
        key: features.key,
        camelot: features.camelot,
        energy: features.energy,
        lufs: loudness,
        ms: Date.now() - startedAt,
      })
    } finally {
      await cleanup()
    }
  }

  /**
   * ffmpeg needs a real path. Local storage has one; object storage does not,
   * so the file is fetched to a staging directory and removed afterwards.
   */
  async #localFile(key: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
    const local = this.#storage.localPath(key)
    if (local) return { file: local, cleanup: () => Promise.resolve() }

    const stagingDir = path.join(this.#config.dataDir, 'incoming')
    await fsp.mkdir(stagingDir, { recursive: true })
    const file = path.join(stagingDir, `analyse-${Date.now()}${path.extname(key)}`)
    await fsp.writeFile(file, await this.#storage.read(key))
    return { file, cleanup: () => fsp.rm(file, { force: true }).catch(() => undefined) }
  }
}

/**
 * Decode a clip of the file to mono float PCM at the analysis rate.
 *
 * Streamed from ffmpeg's stdout rather than via a temp file, capped at the
 * clip length so a two-hour DJ set costs the same as a three-minute song.
 */
export function decode(file: string, duration: number): Promise<Float32Array> {
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

  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { shell: false, windowsHide: true })
    const chunks: Buffer[] = []
    let total = 0
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('ffmpeg timed out decoding the file'))
    }, DECODE_TIMEOUT_MS)

    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      const buffer = Buffer.concat(chunks, total)
      // Float32Array needs 4-byte alignment; a fresh copy guarantees it.
      const aligned = new Float32Array(Math.floor(buffer.length / 4))
      for (let i = 0; i < aligned.length; i++) aligned[i] = buffer.readFloatLE(i * 4)
      resolve(aligned)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (total >= maxBytes) return
      chunks.push(chunk)
      total += chunk.length
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    child.on('error', error => finish(new Error(`could not run ffmpeg: ${error.message}`)))
    child.on('close', code => {
      if (code !== 0 && total === 0) {
        finish(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`))
      } else {
        finish(null)
      }
    })
  })
}

/**
 * Integrated loudness via ffmpeg's `ebur128` filter.
 *
 * The filter prints a summary block on stderr when the input ends; the line
 * we want looks like `I:         -14.2 LUFS`. Returns null when the file is
 * silent (ffmpeg reports -70 LUFS as the floor) or the filter is unavailable.
 */
export function measureLoudness(file: string): Promise<number | null> {
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

  return new Promise<number | null>(resolve => {
    const child = spawn('ffmpeg', args, { shell: false, windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), DECODE_TIMEOUT_MS)

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parseIntegratedLoudness(stderr))
    })
  })
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
