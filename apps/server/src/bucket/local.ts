import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { FORMAT_KEY, messageOf } from '@selfmp3/shared'
import { CloudError, type CloudObject, type CloudPutOptions, type CloudStore } from './store.js'

/**
 * A folder standing in for the bucket.
 *
 * The app does not work without a cloud (docs/SYNC.md): the bucket is the
 * library, and a server with none connected refuses to do anything but connect
 * one. That rule has to hold for the dev profile and the verify lanes too, and
 * neither should need a Backblaze account to run. So `SELFMP3_CLOUD_DIR` names
 * a folder, and this speaks the bucket's five words over it — keys become
 * paths, `list` walks, `range` reads a slice — exactly as the S3 store does over
 * a real one. The sync cannot tell the difference, which is the point.
 *
 * Only a server reads it: a phone or a browser signs in through the doorman
 * and reaches a real bucket, so a folder library is one this server publishes
 * to and streams from, and no other device sees. That is what the dev profile
 * and the lanes have always been.
 *
 * A bucket is not made by writing into it, and neither is this: once the
 * folder is gone — its drive unplugged, the folder moved — every write but
 * the first, `format.json`, is refused as a bucket that is not there. Making
 * the folder again on the way to a file built an empty stand-in the server
 * published into and let go of songs into, and their audio was nowhere once
 * the drive came back (R3-m10).
 */
export class LocalCloudStore implements CloudStore {
  readonly description: string
  readonly #root: string

  constructor(root: string) {
    this.#root = path.resolve(root)
    this.description = `folder · ${this.#root}`
  }

  /** Keys are relative and forward-slashed; nothing may climb out of the folder. */
  #file(key: string): string {
    const segments = key.split('/')
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw new CloudError('other', `not a bucket key: ${JSON.stringify(key)}`)
    }
    return path.join(this.#root, ...segments)
  }

  /** A folder keeps no change counter: the server lists it, and listing a folder costs nothing. */
  changes(): Promise<string | null> {
    return Promise.resolve(null)
  }

  followOwn(held: string): string {
    return held
  }

  async head(key: string): Promise<CloudObject | null> {
    try {
      const stat = await fsp.stat(this.#file(key))
      return stat.isFile() ? { key, size: stat.size } : null
    } catch (error) {
      if (isMissing(error)) return null
      throw explain(error)
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fsp.readFile(this.#file(key))
    } catch (error) {
      if (isMissing(error)) return null
      throw explain(error)
    }
  }

  async range(
    key: string,
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<NodeJS.ReadableStream | null> {
    const file = this.#file(key)
    if (!(await this.head(key))) return null
    return fs.createReadStream(file, { start, end, signal })
  }

  async put(key: string, body: Buffer, _options: CloudPutOptions): Promise<void> {
    const file = this.#file(key)
    if (key !== FORMAT_KEY) await this.#mustBeThere()
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      // Whole or absent, like an object: written beside and renamed into place.
      const partial = `${file}.${process.pid}.part`
      await fsp.writeFile(partial, body)
      await fsp.rename(partial, file)
    } catch (error) {
      throw explain(error)
    }
  }

  async list(prefix: string): Promise<CloudObject[]> {
    // An empty listing says the bucket holds nothing; a folder that is not
    // there says nothing about what the bucket holds.
    if (!fs.existsSync(this.#root)) throw this.#notThere()
    const objects: CloudObject[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) return
        throw explain(error)
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.endsWith('.part')) continue
        const absolute = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(absolute)
          continue
        }
        const key = path.relative(this.#root, absolute).split(path.sep).join('/')
        if (!key.startsWith(prefix)) continue
        const stat = await fsp.stat(absolute)
        objects.push({ key, size: stat.size })
      }
    }
    await walk(this.#root)
    return objects.sort((a, b) => a.key.localeCompare(b.key))
  }

  /** The folder is there and is a bucket: it has the `format.json` written first. */
  async #mustBeThere(): Promise<void> {
    try {
      await fsp.stat(path.join(this.#root, FORMAT_KEY))
    } catch (error) {
      if (isMissing(error)) throw this.#notThere()
      throw explain(error)
    }
  }

  #notThere(): CloudError {
    return new CloudError(
      'missing',
      `The bucket folder ${this.#root} is not there. Is the drive it is on connected?`,
    )
  }

  async delete(key: string): Promise<void> {
    try {
      await fsp.rm(this.#file(key), { force: true })
    } catch (error) {
      throw explain(error)
    }
  }
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'ENOENT'
}

function explain(error: unknown): CloudError {
  if (error instanceof CloudError) return error
  return new CloudError('other', messageOf(error))
}
