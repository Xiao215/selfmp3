import fs from 'node:fs'
import path from 'node:path'
import { AUDIO_EXTENSIONS, LYRIC_EXTENSIONS } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SettingsRepository } from '../repositories/settings.js'
import type { ScannerService } from './scanner.js'
import { debounce, type Debounced } from './debounce.js'

/**
 * Watch the library folder and rescan when something changes.
 *
 * This uses Node's own `fs.watch(dir, { recursive: true })` rather than
 * chokidar. On macOS it is backed by FSEvents (the same mechanism Finder and
 * Spotlight use), and since Node 20 the recursive flag also works on Linux, so
 * it covers both places this server runs with zero dependencies and no native
 * build step. chokidar's extra machinery — polling fallbacks, glob matching,
 * `awaitWriteFinish` — solves problems this app does not have: the scanner is
 * already incremental (unchanged size+mtime is skipped) and idempotent, so a
 * file still being copied is simply picked up again by the next debounced
 * scan once its size settles.
 *
 * Only the local storage driver has a folder to watch; with S3 this is a no-op.
 */

/** Quiet period after the last event before scanning. Finder copies in bursts. */
const QUIET_MS = 1_500
/** Never wait longer than this during a continuous burst. */
const MAX_WAIT_MS = 15_000

const WATCHED_EXTENSIONS = new Set<string>([...AUDIO_EXTENSIONS, ...LYRIC_EXTENSIONS])

/**
 * Is this path worth a rescan? Only audio and lyric files matter, and the
 * dotfiles macOS sprinkles around (`.DS_Store`, `._foo.m4a` resource forks)
 * would otherwise trigger a scan every time Finder looks at the folder.
 */
export function isRelevantChange(relativePath: string | null | undefined): boolean {
  if (!relativePath) return false
  const base = path.basename(relativePath)
  if (base.startsWith('.')) return false
  return WATCHED_EXTENSIONS.has(path.extname(base).toLowerCase())
}

export class LibraryWatcherService {
  readonly #config: Config
  readonly #settings: SettingsRepository
  readonly #scanner: ScannerService
  readonly #onChanged: () => void
  readonly #logger: Logger
  readonly #rescan: Debounced

  #watcher: fs.FSWatcher | null = null
  #stopped = false

  constructor(deps: {
    config: Config
    settings: SettingsRepository
    scanner: ScannerService
    /** Called after a scan that changed something, to bump the library version. */
    onChanged: () => void
    logger: Logger
  }) {
    this.#config = deps.config
    this.#settings = deps.settings
    this.#scanner = deps.scanner
    this.#onChanged = deps.onChanged
    this.#logger = deps.logger.child('watch')
    this.#rescan = debounce(() => this.#scan(), QUIET_MS, MAX_WAIT_MS)
  }

  get isWatching(): boolean {
    return this.#watcher !== null
  }

  /** Start or stop according to the current `watchLibrary` setting. */
  apply(): void {
    if (this.#stopped) return
    const wanted = this.#settings.get().watchLibrary && this.#config.storageDriver === 'local'
    if (wanted && !this.#watcher) this.#start()
    else if (!wanted && this.#watcher) this.#close()
  }

  stop(): void {
    this.#stopped = true
    this.#close()
  }

  #start(): void {
    try {
      this.#watcher = fs.watch(
        this.#config.libraryDir,
        { recursive: true, persistent: false },
        (_event, filename) => {
          const name = filename ?? null
          if (!isRelevantChange(name)) return
          this.#logger.debug('change', { file: name })
          this.#rescan.trigger()
        },
      )
      this.#watcher.on('error', error => {
        this.#logger.warn('watcher stopped', { message: error.message })
        this.#close()
      })
      this.#logger.info('watching library folder', { dir: this.#config.libraryDir })
    } catch (error) {
      this.#watcher = null
      this.#logger.warn('could not watch library folder', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  #close(): void {
    this.#rescan.cancel()
    if (!this.#watcher) return
    this.#watcher.close()
    this.#watcher = null
    this.#logger.debug('stopped watching')
  }

  #scan(): void {
    if (this.#stopped) return
    // A scan already running means the change will be seen by it or by the
    // next trigger; asking again just gets a no-op result from the guard.
    if (this.#scanner.isRunning) {
      this.#rescan.trigger()
      return
    }
    void this.#scanner
      .scan()
      .then(result => {
        if (result.added || result.updated || result.removed) {
          this.#logger.info('library changed', {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
          })
          this.#onChanged()
        }
      })
      .catch((error: unknown) => {
        this.#logger.error('rescan failed', {
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }
}
