import fsp from 'node:fs/promises'
import path from 'node:path'
import { isCloudFileKey, isHashNamedCloudKey } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { messageOf } from '../util/errors.js'

/**
 * Small files from the bucket, kept on this disk once read or sent: a song's
 * words, once the sidecar beside its audio has been let go.
 *
 * Every server start reads the words of every song that has any — the search
 * index and the romaji pass both run over the whole library — and each read
 * from the bucket is a counted call (docs/SYNC.md, "Caps"): 381 of them on
 * every restart of a library of 1,472, on 2026-10-07. The words do not change
 * under their key — every file here is named by the hash of its bytes — so a
 * kept copy is never stale, and is read from disk ever after.
 *
 * Kept under the data folder (`cloud-files/<key>`), like the phone's text
 * cache: what the bucket holds, kept here, not a copy only this server has.
 * A file goes when the bucket's does (`forget`, from the trash), and a cache
 * that fails is a miss, never a failure.
 */
export class KeptCloudFiles {
  readonly #dir: string
  readonly #logger: Logger

  constructor(dir: string, logger: Logger) {
    this.#dir = dir
    this.#logger = logger.child('kept')
  }

  /** The kept bytes, or null when there are none (or the key is not one kept here). */
  async read(key: string): Promise<Buffer | null> {
    const file = this.#file(key)
    if (!file) return null
    try {
      return await fsp.readFile(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.#logger.warn('could not read a kept file', { key, message: messageOf(error) })
      }
      return null
    }
  }

  /** Keep these bytes under their key: written whole beside it, then renamed into place. */
  async keep(key: string, data: Buffer): Promise<void> {
    const file = this.#file(key)
    if (!file) return
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(temp, data)
      await fsp.rename(temp, file)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      this.#logger.warn('could not keep a file', { key, message: messageOf(error) })
    }
  }

  /** The bucket let go of this file: so does this disk. */
  async forget(key: string): Promise<void> {
    const file = this.#file(key)
    if (!file) return
    await fsp.rm(file, { force: true }).catch((error: unknown) => {
      this.#logger.warn('could not forget a kept file', { key, message: messageOf(error) })
    })
  }

  /**
   * Where a key is kept: only a file named by its hash, whose key the shared
   * package has checked has no `..` or anything else that could climb out.
   */
  #file(key: string): string | null {
    if (!isCloudFileKey(key) || !isHashNamedCloudKey(key)) return null
    return path.join(this.#dir, ...key.split('/'))
  }
}
