import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'

/**
 * Disk cache for things derived from lyrics: today, romanization.
 *
 * The lyrics themselves are cached as sidecars next to the audio, because they
 * are the user's files. Romanization is disposable output computed *from*
 * those files, so — like cover art — it lives under the data directory
 * (`data/lyrics/<songId>/`), keyed by a hash of the lyric text. Edit the
 * sidecar and the hash changes, so a stale cache is simply never hit; the old
 * entries are swept when a new one is written.
 */
export class LyricsCache {
  readonly #dir: string
  readonly #logger: Logger

  constructor(config: Config, logger: Logger) {
    this.#dir = path.join(config.dataDir, 'lyrics')
    this.#logger = logger.child('lyrics-cache')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  /** Stable, short identity for a lyrics text. */
  static hash(text: string): string {
    return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16)
  }

  #file(songId: number, kind: string, hash: string): string {
    return path.join(this.#dir, String(songId), `${kind}.${hash}.json`)
  }

  async read<T>(songId: number, kind: string, hash: string): Promise<T | null> {
    try {
      const raw = await fsp.readFile(this.#file(songId, kind, hash), 'utf8')
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }

  async write(songId: number, kind: string, hash: string, value: unknown): Promise<void> {
    const file = this.#file(songId, kind, hash)
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, JSON.stringify(value), 'utf8')
      await this.#sweep(songId, kind, hash)
    } catch (error) {
      // A cache miss next time is the only consequence.
      this.#logger.warn('could not write lyrics cache', {
        songId,
        kind,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Remove entries of this kind that were built from an older lyrics text. */
  async #sweep(songId: number, kind: string, keepHash: string): Promise<void> {
    const dir = path.join(this.#dir, String(songId))
    const entries = await fsp.readdir(dir).catch(() => [] as string[])
    for (const name of entries) {
      if (name.startsWith(`${kind}.`) && !name.startsWith(`${kind}.${keepHash}.`)) {
        await fsp.rm(path.join(dir, name), { force: true }).catch(() => undefined)
      }
    }
  }

  async delete(songId: number): Promise<void> {
    await fsp
      .rm(path.join(this.#dir, String(songId)), { recursive: true, force: true })
      .catch(() => undefined)
  }
}
