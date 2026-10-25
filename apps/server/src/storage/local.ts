import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileEtag, AUDIO_EXTENSIONS } from '@selfmp3/shared'
import type { RangeSource } from '../http/range.js'
import { normalizeKey, type StorageDriver, type StorageStat } from './driver.js'

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS)

/** The library folder on the local filesystem. */
/** Whether `absolute` is `root` or somewhere under it. */
const within = (root: string, absolute: string): boolean =>
  absolute === root || absolute.startsWith(root.endsWith(path.sep) ? root : root + path.sep)

export class LocalStorageDriver implements StorageDriver {
  readonly #root: string
  /** The root with its own symlinks followed (`/tmp` is `/private/tmp` on a Mac). */
  readonly #realRoot: string

  constructor(root: string) {
    this.#root = path.resolve(root)
    fs.mkdirSync(this.#root, { recursive: true })
    this.#realRoot = fs.realpathSync(this.#root)
  }

  /**
   * Resolve a key to an absolute path, refusing anything that escapes the
   * root. `normalizeKey` already strips `..`; a symlink could still point
   * outside (`ln -s /etc/passwd song.mp3`), so where the path really leads —
   * or, for a file not written yet, where its nearest existing folder does —
   * is checked as well.
   */
  #resolve(key: string): string {
    const absolute = path.resolve(this.#root, normalizeKey(key))
    if (!within(this.#root, absolute) || !within(this.#realRoot, this.#real(absolute))) {
      throw new Error(`storage key escapes the library root: ${key}`)
    }
    return absolute
  }

  /** `absolute` with its symlinks followed, as far up as it exists. */
  #real(absolute: string): string {
    let existing = absolute
    for (;;) {
      try {
        return path.join(fs.realpathSync(existing), path.relative(existing, absolute))
      } catch {
        const parent = path.dirname(existing)
        if (parent === existing) return absolute
        existing = parent
      }
    }
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
        etag: fileEtag(stat.size, stat.mtimeMs),
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
        // Skip dotfiles, macOS's `._` resource forks among them.
        if (entry.name.startsWith('.')) continue
        const absolute = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(absolute)
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          if (!AUDIO_EXTENSION_SET.has(path.extname(entry.name).toLowerCase())) continue
          // A link counts only when it leads to a file inside the folder.
          if (entry.isSymbolicLink() && !(await this.#linksInside(absolute))) continue
          found.push(path.relative(this.#root, absolute).split(path.sep).join('/'))
        }
      }
    }

    await walk(this.#root)
    found.sort((a, b) => a.localeCompare(b))
    return found
  }

  async #linksInside(absolute: string): Promise<boolean> {
    try {
      const target = await fsp.realpath(absolute)
      return within(this.#realRoot, target) && (await fsp.stat(target)).isFile()
    } catch {
      return false
    }
  }

  async read(key: string): Promise<Buffer> {
    return fsp.readFile(this.#resolve(key))
  }

  async write(key: string, data: Buffer | NodeJS.ReadableStream): Promise<void> {
    const absolute = this.#resolve(key)
    await fsp.mkdir(path.dirname(absolute), { recursive: true })

    // Write to a temp file and rename, so a crash mid-write can never leave a
    // truncated audio file that the scanner would then happily index. Named
    // uniquely, so two writes of one key at once cannot share a temp file.
    const temp = `${absolute}.${randomUUID()}.tmp`
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

  localPath(key: string): string {
    return this.#resolve(key)
  }
}
