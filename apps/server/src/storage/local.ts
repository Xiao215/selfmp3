import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { AUDIO_EXTENSIONS } from '@selfmp3/shared'
import type { RangeSource } from '../http/range.js'
import { normalizeKey, type StorageDriver, type StorageStat } from './driver.js'

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS)

/**
 * Local filesystem storage — the default, and what you want when the library
 * lives on the same machine as the server.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local'
  readonly #root: string

  constructor(root: string) {
    this.#root = path.resolve(root)
    fs.mkdirSync(this.#root, { recursive: true })
  }

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the
   * root. `normalizeKey` already strips `..`, but a symlink could still point
   * outside, so the resolved path is checked as well.
   */
  #resolve(key: string): string {
    const absolute = path.resolve(this.#root, normalizeKey(key))
    const rootWithSep = this.#root.endsWith(path.sep) ? this.#root : this.#root + path.sep
    if (absolute !== this.#root && !absolute.startsWith(rootWithSep)) {
      throw new Error(`storage key escapes the library root: ${key}`)
    }
    return absolute
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.#resolve(key), fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }

  async stat(key: string): Promise<StorageStat | null> {
    try {
      const stat = await fsp.stat(this.#resolve(key))
      if (!stat.isFile()) return null
      return {
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
        etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      }
    } catch {
      return null
    }
  }

  async list(): Promise<string[]> {
    const found: string[] = []

    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        // Skip dotfiles and macOS resource forks.
        if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue
        const absolute = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(absolute)
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          if (AUDIO_EXTENSION_SET.has(path.extname(entry.name).toLowerCase())) {
            found.push(path.relative(this.#root, absolute).split(path.sep).join('/'))
          }
        }
      }
    }

    await walk(this.#root)
    found.sort((a, b) => a.localeCompare(b))
    return found
  }

  async read(key: string): Promise<Buffer> {
    return fsp.readFile(this.#resolve(key))
  }

  async write(key: string, data: Buffer | NodeJS.ReadableStream): Promise<void> {
    const absolute = this.#resolve(key)
    await fsp.mkdir(path.dirname(absolute), { recursive: true })

    // Write to a temp file and rename, so a crash mid-write can never leave a
    // truncated audio file that the scanner would then happily index.
    const temp = `${absolute}.${process.pid}.tmp`
    try {
      if (Buffer.isBuffer(data)) {
        await fsp.writeFile(temp, data)
      } else {
        await pipeline(
          data instanceof Readable ? data : Readable.from(data),
          fs.createWriteStream(temp),
        )
      }
      await fsp.rename(temp, absolute)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.#resolve(key), { force: true })
  }

  async rangeSource(key: string, mime: string): Promise<RangeSource | null> {
    const absolute = this.#resolve(key)
    const stat = await this.stat(key)
    if (!stat) return null
    return {
      sizeBytes: stat.sizeBytes,
      mime,
      etag: stat.etag,
      lastModified: stat.modifiedAt,
      open: (start, end, signal) =>
        Promise.resolve(fs.createReadStream(absolute, { start, end, signal })),
    }
  }

  signedUrl(): Promise<string | null> {
    // Local files have no externally fetchable URL; callers stream via the API.
    return Promise.resolve(null)
  }

  localPath(key: string): string | null {
    return this.#resolve(key)
  }
}
