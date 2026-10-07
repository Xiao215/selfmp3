import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { USER_AGENT, type Config } from '../config.js'
import type { Logger } from '../logger.js'
import { messageOf } from '../util/errors.js'

/**
 * The listening model's files, and getting them onto this machine.
 *
 * They are CLaMP 3 (with MERT under it) as `scripts/sound-models` exports it
 * to ONNX: about 750 MB, too big for the image and for git, so they are a
 * release of the repository and the server downloads them the first time
 * analysis wants them. Each file's hash is written here, so what runs is
 * exactly what was checked against the original model, whoever serves it.
 */

export interface ModelFile {
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

/** Bump `name` with the files: a vector made by one model means nothing to another. */
export const SOUND_MODEL = {
  name: 'clamp3-saas-1',
  files: [
    {
      name: 'mert.onnx',
      bytes: 122_357_465,
      sha256: '62e1d730bab190baa0ad0a045d7b51e664ba4a8ca1234e27224ce68646b8dbcd',
    },
    {
      name: 'clamp3_audio.onnx',
      bytes: 86_526_100,
      sha256: '9acfe744fdfa306e2043f1b960e3e3640ca751702a0b7c7b3aefc945096fba2a',
    },
    {
      name: 'clamp3_text.onnx',
      bytes: 535_300_285,
      sha256: 'fae5634245b2cc95e08310dc18a5e6ed163ede3622450ca2950009e780e760e7',
    },
    {
      name: 'tokenizer.json',
      bytes: 9_096_718,
      sha256: 'a898ea75433890f6610f4e470b8ebeb0c21dce5c8dd61f892eb09eb5919d2e2c',
    },
    {
      name: 'tokenizer_config.json',
      bytes: 25,
      sha256: '994f46754c5bf4014f1aa92d34b1374319c3a6b3f702105cd5b742beaecd18ce',
    },
  ] satisfies readonly ModelFile[],
} as const

/** A failed download is tried again after this long, not on every song. */
const RETRY_AFTER_MS = 60 * 60_000

/** Written beside the files once every hash has matched, so later boots need not read 750 MB. */
const CHECKED = '.checked'

type State = 'idle' | 'fetching' | 'ready' | 'failed'

export class SoundModelFiles {
  readonly #source: string
  readonly #dataDir: string
  readonly #logger: Logger
  readonly #fetch: typeof fetch
  readonly #files: readonly ModelFile[]
  #state: State = 'idle'
  #message: string | null = null
  #failedAt = 0
  #pending: Promise<string | null> | null = null
  #dir: string | null = null

  constructor(deps: {
    config: Pick<Config, 'dataDir' | 'sound'>
    logger: Logger
    fetch?: typeof fetch
    /** What to fetch; a test's few small files instead of the model's. */
    files?: readonly ModelFile[]
  }) {
    this.#source = deps.config.sound.models
    this.#dataDir = deps.config.dataDir
    this.#logger = deps.logger.child('sound-models')
    this.#fetch = deps.fetch ?? fetch
    this.#files = deps.files ?? SOUND_MODEL.files
  }

  get state(): State {
    return this.#state
  }

  /** Why the files could not be had, in words for Settings. */
  get message(): string | null {
    return this.#message
  }

  /** When a failed attempt may be made again, or null when none failed. */
  get retryAt(): number | null {
    return this.#state === 'failed' ? this.#failedAt + RETRY_AFTER_MS : null
  }

  /**
   * The folder holding every file, fetching what is missing first; null when
   * they could not be had (and `message` says why). One attempt at a time,
   * and none within the hour after a failed one.
   */
  ensure(now = Date.now()): Promise<string | null> {
    if (this.#dir) return Promise.resolve(this.#dir)
    if (this.#state === 'failed' && now < this.#failedAt + RETRY_AFTER_MS) {
      return Promise.resolve(null)
    }
    this.#pending ??= this.#get().finally(() => {
      this.#pending = null
    })
    return this.#pending
  }

  async #get(): Promise<string | null> {
    try {
      const dir = isUrl(this.#source) ? await this.#download() : await this.#local(this.#source)
      this.#dir = dir
      this.#state = 'ready'
      this.#message = null
      return dir
    } catch (error) {
      this.#state = 'failed'
      this.#failedAt = Date.now()
      this.#message = messageOf(error)
      this.#logger.warn('could not get the listening model', { message: this.#message })
      return null
    }
  }

  /** A folder that already has the files, as an export leaves them. */
  async #local(dir: string): Promise<string> {
    for (const file of this.#files) {
      const stat = await fsp.stat(path.join(dir, file.name)).catch(() => null)
      if (stat?.size !== file.bytes) {
        throw new Error(`${path.join(dir, file.name)} is missing or not the expected file`)
      }
    }
    return dir
  }

  async #download(): Promise<string> {
    const dir = path.join(this.#dataDir, 'models', SOUND_MODEL.name)
    const expected = JSON.stringify(this.#files)
    const checked = await fsp.readFile(path.join(dir, CHECKED), 'utf8').catch(() => null)
    if (checked === expected && (await this.#sizesMatch(dir))) return dir

    this.#state = 'fetching'
    await fsp.mkdir(dir, { recursive: true })
    for (const file of this.#files) {
      const target = path.join(dir, file.name)
      if (await hashMatches(target, file)) continue
      this.#logger.info('downloading', { file: file.name, mb: Math.round(file.bytes / 1e6) })
      await this.#fetchFile(`${this.#source.replace(/\/+$/, '')}/${file.name}`, target, file)
    }
    await fsp.writeFile(path.join(dir, CHECKED), expected)
    this.#logger.info('listening model ready', { dir })
    return dir
  }

  async #sizesMatch(dir: string): Promise<boolean> {
    for (const file of this.#files) {
      const stat = await fsp.stat(path.join(dir, file.name)).catch(() => null)
      if (stat?.size !== file.bytes) return false
    }
    return true
  }

  /** One file, hashed as it streams in, kept only if the hash is the one written above. */
  async #fetchFile(url: string, target: string, file: ModelFile): Promise<void> {
    const response = await this.#fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok || !response.body) {
      throw new Error(`downloading ${file.name} failed: ${response.status} ${response.statusText}`)
    }
    const partial = `${target}.part`
    const hash = createHash('sha256')
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk)
            done(null, chunk)
          },
        }),
        fs.createWriteStream(partial),
      )
      const sha256 = hash.digest('hex')
      if (sha256 !== file.sha256) {
        throw new Error(`${file.name} arrived different from the file it should be`)
      }
      await fsp.rename(partial, target)
    } finally {
      await fsp.rm(partial, { force: true })
    }
  }
}

function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

async function hashMatches(target: string, file: ModelFile): Promise<boolean> {
  const stat = await fsp.stat(target).catch(() => null)
  if (stat?.size !== file.bytes) return false
  const hash = createHash('sha256')
  await pipeline(fs.createReadStream(target), hash)
  return hash.digest('hex') === file.sha256
}
