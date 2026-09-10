import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'

/**
 * Cover art cache.
 *
 * Art is extracted from the audio file once and written to `data/covers/<id>`,
 * rather than re-parsing a 6 MB file every time a list of forty songs scrolls
 * past. The cache is disposable: delete the folder and a rescan rebuilds it.
 */

const EXTENSIONS = ['.jpg', '.png', '.webp'] as const

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export class CoverService {
  readonly #dir: string
  readonly #songs: SongRepository
  readonly #logger: Logger

  constructor(config: Config, songs: SongRepository, logger: Logger) {
    this.#dir = path.join(config.dataDir, 'covers')
    this.#songs = songs
    this.#logger = logger.child('covers')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  #pathFor(songId: number, extension: string): string {
    return path.join(this.#dir, `${songId}${extension}`)
  }

  async save(songId: number, data: Buffer, extension: string): Promise<void> {
    const ext = (EXTENSIONS as readonly string[]).includes(extension) ? extension : '.jpg'
    try {
      await fsp.writeFile(this.#pathFor(songId, ext), data)
      this.#songs.setArt(songId, true, ext)
    } catch (error) {
      // Missing art is cosmetic; a placeholder gradient is shown instead.
      this.#logger.warn('could not cache cover art', {
        songId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /** Locate a cached cover, whatever format it was stored in. */
  find(songId: number): { path: string; contentType: string } | null {
    for (const extension of EXTENSIONS) {
      const file = this.#pathFor(songId, extension)
      if (fs.existsSync(file)) {
        return { path: file, contentType: CONTENT_TYPES[extension] ?? 'image/jpeg' }
      }
    }
    return null
  }

  async delete(songId: number): Promise<void> {
    for (const extension of EXTENSIONS) {
      await fsp.rm(this.#pathFor(songId, extension), { force: true }).catch(() => undefined)
    }
  }

  /** Download art from a URL (used for imports where yt-dlp gave a thumbnail). */
  async saveFromUrl(songId: number, url: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!response.ok) return false

      const contentType = response.headers.get('content-type') ?? ''
      const extension = contentType.includes('png')
        ? '.png'
        : contentType.includes('webp')
          ? '.webp'
          : '.jpg'

      const data = Buffer.from(await response.arrayBuffer())
      // Guard against a redirect to an HTML error page.
      if (data.length < 512) return false

      await this.save(songId, data, extension)
      return true
    } catch {
      return false
    }
  }
}
