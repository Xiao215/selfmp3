import { spawn } from 'node:child_process'
import type { AnalysisStatus, Song } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SoundVectorsRepository } from '../repositories/soundVectors.js'
import { Clamp3, type SoundModel } from './clamp3.js'
import { SOUND_MODEL, SoundModelFiles } from './models.js'
import { dot, SOUND_SAMPLE_RATE, WINDOW_SECONDS, windowStarts } from './vectors.js'

/**
 * How songs sound (docs/features/audio-intelligence.md, "How songs sound").
 *
 * Each song is heard once by CLaMP 3 and kept as a vector: three ten-second
 * windows of it, through MERT and CLaMP 3's audio encoder. A description in
 * words goes through the text encoder into the same space, so "calm orchestral
 * music with flute" and a song can be compared by a dot product, and so can
 * two songs. The analysis loop does the hearing (services/analysis.ts); this
 * is the model, the vectors, and the two questions they answer.
 */

/** A shared tag nudges a song up "sounds like" by this much, for at most two. */
const TAG_NUDGE = 0.015
/** The same artist, by this much: the song's own sound still decides. */
const ARTIST_NUDGE = 0.02

const DECODE_TIMEOUT_MS = 60_000

export class SoundService {
  readonly #enabled: boolean
  readonly #threads: number
  readonly #vectors: SoundVectorsRepository
  readonly #files: SoundModelFiles
  readonly #makeModel: (dir: string, threads: number) => SoundModel
  readonly #logger: Logger
  #model: SoundModel | null = null
  #cache: Map<number, Float32Array> | null = null

  constructor(deps: {
    config: Pick<Config, 'dataDir' | 'sound'>
    vectors: SoundVectorsRepository
    logger: Logger
    /** The files' source; a test's own. */
    files?: SoundModelFiles
    /** The model on the files; a test's fake. */
    makeModel?: (dir: string, threads: number) => SoundModel
  }) {
    this.#enabled = deps.config.sound.enabled
    this.#threads = deps.config.sound.threads
    this.#vectors = deps.vectors
    this.#logger = deps.logger.child('sound')
    this.#files = deps.files ?? new SoundModelFiles({ config: deps.config, logger: deps.logger })
    this.#makeModel = deps.makeModel ?? ((dir, threads) => new Clamp3(dir, threads))
  }

  get enabled(): boolean {
    return this.#enabled
  }

  /** Whether the model can be used right now, without waiting for anything. */
  get isReady(): boolean {
    return this.#model !== null
  }

  /** When to try for the model again after it could not be had; null otherwise. */
  get retryAt(): number | null {
    return this.#enabled ? this.#files.retryAt : null
  }

  status(): AnalysisStatus['sound'] {
    const state = !this.#enabled
      ? 'off'
      : this.#model
        ? 'ready'
        : this.#files.state === 'failed'
          ? 'failed'
          : this.#files.state === 'fetching'
            ? 'fetching'
            : 'waiting'
    return {
      state,
      heard: this.#vectors.countHeard(SOUND_MODEL.name),
      pending: this.#enabled ? this.#vectors.countPending(SOUND_MODEL.name) : 0,
      message: state === 'failed' ? this.#files.message : null,
    }
  }

  /**
   * Get the model ready, downloading its files the first time. False when it
   * is off or could not be had; never throws.
   */
  async prepare(): Promise<boolean> {
    if (!this.#enabled) return false
    if (this.#model) return true
    const dir = await this.#files.ensure()
    if (!dir) return false
    if (!this.#model) {
      this.#model = this.#makeModel(dir, this.#threads)
      this.#logger.info('listening model ready', {
        model: SOUND_MODEL.name,
        threads: this.#threads,
      })
    }
    return true
  }

  /** The next song waiting to be heard, newest first, passing over the ones in `skip`. */
  nextPending(skip?: ReadonlySet<number>): number | null {
    return this.#enabled ? this.#vectors.nextPending(SOUND_MODEL.name, skip) : null
  }

  /** Whether the song has been heard (or found unhearable) by this model. */
  has(songId: number): boolean {
    return this.#vectors.has(songId, SOUND_MODEL.name)
  }

  /**
   * Hear a song from a file on this disk and keep its vector. Throws when it
   * cannot; `markUnhearable` then records that, so it is not tried forever.
   */
  async hear(songId: number, file: string, duration: number): Promise<void> {
    const model = this.#model
    if (!model) throw new Error('the listening model is not ready')
    const vector = await model.hearClip(await decodeWindows(file, duration))
    this.#vectors.upsert(songId, SOUND_MODEL.name, vector)
    this.#cache?.set(songId, vector)
  }

  markUnhearable(songId: number): void {
    this.#vectors.upsert(songId, SOUND_MODEL.name, null)
    this.#cache?.delete(songId)
  }

  /** The file changed underneath a song: hear it again. */
  forget(songId: number): void {
    this.#vectors.delete(songId)
    this.#cache?.delete(songId)
  }

  #all(): Map<number, Float32Array> {
    this.#cache ??= this.#vectors.all(SOUND_MODEL.name)
    return this.#cache
  }

  /**
   * How well each song sounds like the words, by song id, for the songs that
   * have been heard. Null when there is nothing to rank with: the model off,
   * not ready, or no song heard yet. Loads the text half of the model.
   */
  async match(text: string, songIds: readonly number[]): Promise<Map<number, number> | null> {
    const all = this.#all()
    if (!this.#enabled || all.size === 0 || !(await this.prepare()) || !this.#model) return null
    const query = await this.#model.readText(text)
    const out = new Map<number, number>()
    for (const id of songIds) {
      const vector = all.get(id)
      if (vector) out.set(id, dot(query, vector))
    }
    return out
  }

  /** How close each song sounds to one song, by id; null when that song has not been heard. */
  closeTo(seedId: number, songIds: readonly number[]): Map<number, number> | null {
    const all = this.#all()
    const seed = all.get(seedId)
    if (!seed) return null
    const out = new Map<number, number>()
    for (const id of songIds) {
      const vector = all.get(id)
      if (vector && id !== seedId) out.set(id, dot(seed, vector))
    }
    return out
  }

  /**
   * "Sounds like": the songs that sound closest to the seed, nudged a little
   * by the tags they share and the same artist. Null when the seed has not
   * been heard, so the caller falls back to tempo, key and energy. Songs not
   * heard yet come after, by that same older measure (`fallback`).
   */
  similar(seed: Song, library: readonly Song[], limit: number, fallback: Song[]): Song[] | null {
    const close = this.closeTo(
      seed.id,
      library.map(song => song.id),
    )
    if (!close || close.size === 0) return null
    const seedTags = new Set(seed.tagIds)
    const artist = seed.artist.toLowerCase()
    const scored = library
      .filter(song => close.has(song.id))
      .map(song => {
        const shared = song.tagIds.filter(id => seedTags.has(id)).length
        const sameArtist = artist !== '' && song.artist.toLowerCase() === artist
        return {
          song,
          score:
            close.get(song.id)! + Math.min(shared, 2) * TAG_NUDGE + (sameArtist ? ARTIST_NUDGE : 0),
        }
      })
      .sort((a, b) => b.score - a.score || a.song.id - b.song.id)
      .map(entry => entry.song)
    const heard = new Set(scored.map(song => song.id))
    return [...scored, ...fallback.filter(song => !heard.has(song.id))].slice(0, limit)
  }

  async close(): Promise<void> {
    await this.#model?.close()
    this.#model = null
  }
}

/**
 * The windows `windowStarts` chooses, decoded back to back at 24 kHz mono:
 * one ffmpeg, an input per window, joined by its concat filter.
 */
export function decodeWindows(file: string, duration: number): Promise<Float32Array> {
  const starts = windowStarts(duration)
  const inputs = starts.flatMap(start => [
    '-ss',
    String(start),
    '-t',
    String(starts.length === 1 ? WINDOW_SECONDS * 3 : WINDOW_SECONDS),
    '-i',
    file,
  ])
  const join =
    starts.length > 1
      ? [
          '-filter_complex',
          `${starts.map((_, i) => `[${i}:a]`).join('')}concat=n=${starts.length}:v=0:a=1`,
        ]
      : ['-vn']
  const args = [
    '-v',
    'error',
    '-nostdin',
    ...inputs,
    ...join,
    '-ac',
    '1',
    '-ar',
    String(SOUND_SAMPLE_RATE),
    '-f',
    'f32le',
    '-',
  ]

  return new Promise<Float32Array>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { shell: false, windowsHide: true })
    const parts: Buffer[] = []
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('ffmpeg timed out decoding the windows'))
    }, DECODE_TIMEOUT_MS)
    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) return reject(error)
      const bytes = Buffer.concat(parts)
      const pcm = new Float32Array(Math.floor(bytes.length / 4))
      for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readFloatLE(i * 4)
      resolve(pcm)
    }
    child.stdout.on('data', (chunk: Buffer) => parts.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    child.on('error', error => finish(new Error(`could not run ffmpeg: ${error.message}`)))
    child.on('close', code => {
      if (code !== 0)
        finish(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`))
      else finish(null)
    })
  })
}
