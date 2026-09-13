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
  /** A cover was written: its colour wants reading. */
  onSaved: ((songId: number) => void) | null = null

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
      // A cover in another format stays behind otherwise — and `find` checks
      // formats in a fixed order, so an old .jpg would keep being served over
      // a new .png, and the replacement would seem not to have happened.
      await Promise.all(
        EXTENSIONS.filter(other => other !== ext).map(other =>
          fsp.rm(this.#pathFor(songId, other), { force: true }),
        ),
      )
      this.#songs.setArt(songId, true, ext)
      this.onSaved?.(songId)
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

  /**
   * Download art from a URL (used for imports where yt-dlp gave a thumbnail).
   *
   * The ten seconds cover the whole thing, headers and body together. Stopping
   * the clock once the headers arrived left a server that answers promptly and
   * then trickles able to hold this open indefinitely — and the fix-covers pass
   * waits on this one song at a time, so one slow host wedged the lot with no
   * way to stop or restart it. The size cap is for the same reason from the
   * other direction: a cover is tens of kilobytes, and nothing says the thing
   * at the end of that URL is a cover.
   */
  async saveFromUrl(songId: number, url: string): Promise<boolean> {
    // `z.string().url()` upstream says it is a URL, not that it is a web
    // address; art comes off the web and nothing else is worth fetching.
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return false

      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > MAX_COVER_BYTES) return false

      const contentType = response.headers.get('content-type') ?? ''
      const extension = contentType.includes('png')
        ? '.png'
        : contentType.includes('webp')
          ? '.webp'
          : '.jpg'

      const data = await readCapped(response, MAX_COVER_BYTES)
      // Guard against a redirect to an HTML error page.
      if (!data || data.length < 512) return false

      await this.save(songId, data, extension)
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Cover art is tens of kilobytes; past this it is not cover art. */
const MAX_COVER_BYTES = 8 * 1024 * 1024

/**
 * The body, or null if it runs past `limit`.
 *
 * Read in chunks rather than through `arrayBuffer()` so an unannounced huge
 * response is dropped as it arrives instead of after it has all been held.
 */
async function readCapped(response: Response, limit: number): Promise<Buffer | null> {
  if (!response.body) return null
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > limit) return null
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
