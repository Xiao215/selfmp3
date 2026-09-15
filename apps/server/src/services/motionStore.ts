import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { MOTION_VERSION, type Motion } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { MotionCurveData } from './dsp.js'

/**
 * Each song's motion curve (schemas/motion.ts), one JSON file per song under
 * the data directory: `data/motion/<songId>.json`.
 *
 * Like the romaji in `LyricsCache`, it is output computed from the user's file
 * rather than the user's file, so it lives with the other disposable things
 * and not beside the audio. Analysis writes it; a changed file, a removed song
 * or a failed analysis deletes it; the next analysis writes it again.
 */
export class MotionStore {
  readonly #dir: string
  readonly #logger: Logger

  constructor(config: Pick<Config, 'dataDir'>, logger: Logger) {
    this.#dir = path.join(config.dataDir, 'motion')
    this.#logger = logger.child('motion')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  #file(songId: number): string {
    return path.join(this.#dir, `${songId}.json`)
  }

  /**
   * Written to a temporary name and renamed into place, so a reader — the
   * route, or a cloud pass hashing it — never sees half a file.
   */
  async write(songId: number, curve: MotionCurveData): Promise<void> {
    const file = this.#file(songId)
    const temporary = `${file}.${process.pid}.tmp`
    try {
      await fsp.mkdir(this.#dir, { recursive: true })
      await fsp.writeFile(temporary, JSON.stringify(motionJson(curve)), 'utf8')
      await fsp.rename(temporary, file)
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => undefined)
      // No curve is a visual that follows the tempo instead: never worth failing analysis over.
      this.#logger.warn('could not write a motion curve', {
        songId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** The file as written, and when it was: the route sends it as it is. */
  async read(songId: number): Promise<{ json: string; mtimeMs: number; size: number } | null> {
    try {
      const file = this.#file(songId)
      const [json, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)])
      return { json, mtimeMs: stat.mtimeMs, size: stat.size }
    } catch {
      return null
    }
  }

  /** The file's bytes, for the cloud, or null when the song has no curve. */
  async bytes(songId: number): Promise<Buffer | null> {
    try {
      return await fsp.readFile(this.#file(songId))
    } catch {
      return null
    }
  }

  /** Size and time of the file, without reading it: what a cloud pass compares. */
  async stat(songId: number): Promise<{ size: number; mtimeMs: number } | null> {
    try {
      const stat = await fsp.stat(this.#file(songId))
      return { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch {
      return null
    }
  }

  async delete(songId: number): Promise<void> {
    await fsp.rm(this.#file(songId), { force: true }).catch(() => undefined)
  }
}

/** A curve as the JSON the route and the bucket carry. */
export function motionJson(curve: MotionCurveData): Motion {
  return {
    version: MOTION_VERSION,
    rate: curve.rate,
    duration: Math.round(curve.duration * 1000) / 1000,
    loudness: Buffer.from(curve.loudness).toString('base64'),
    onset: Buffer.from(curve.onset).toString('base64'),
  }
}
