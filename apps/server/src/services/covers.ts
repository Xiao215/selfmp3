import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import { readCapped } from './fetching.js'
import { squareCover } from './squareCover.js'
import { messageOf } from '../util/errors.js'

/**
 * This server's copy of every cover, in `data/covers/<id>`.
 *
 * A cover arrives once — read out of a file the inbox sweep found, fetched
 * with an import, or picked by hand — and is kept here rather than re-read
 * from a 6 MB file every time a list of forty songs scrolls past. It is not a
 * cache to throw away: the audio it came from is let go once it is in the
 * bucket (docs/SYNC.md), `/api/art/:id` serves only what is here, and the
 * cloud pass uploads the cover from here. Delete the folder and the covers
 * are gone from this server.
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
  /** Thumbnails being made, so requests for the same one share the work. */
  readonly #making = new Map<string, Promise<{ path: string; contentType: string }>>()

  constructor(config: Config, songs: SongRepository, logger: Logger) {
    this.#dir = path.join(config.dataDir, 'covers')
    this.#songs = songs
    this.#logger = logger.child('covers')
    fs.mkdirSync(this.#dir, { recursive: true })
  }

  #pathFor(songId: number, extension: string): string {
    return path.join(this.#dir, `${songId}${extension}`)
  }

  async save(songId: number, given: Buffer, extension: string): Promise<void> {
    try {
      // Square before it is kept, so every copy of it everywhere is
      // (squareCover.ts). A picture sharp cannot read is kept as it came.
      const { data, extension: squared } = await squareCover(given, extension).catch(() => ({
        data: given,
        extension,
      }))
      const ext = (EXTENSIONS as readonly string[]).includes(squared) ? squared : '.jpg'
      await fsp.writeFile(this.#pathFor(songId, ext), data)
      // A cover in another format would stay behind otherwise, a stale file
      // nothing serves: `find` looks only for the format recorded below.
      await Promise.all(
        EXTENSIONS.filter(other => other !== ext).map(other =>
          fsp.rm(this.#pathFor(songId, other), { force: true }),
        ),
      )
      this.#songs.setArt(songId, true, ext)
      // Made from the picture just replaced, and named by its time, so no
      // request would ever ask for them again.
      await this.#dropThumbnails(songId)
      this.onSaved?.(songId)
    } catch (error) {
      // Missing art is cosmetic; a placeholder gradient is shown instead.
      this.#logger.warn('could not cache cover art', {
        songId,
        message: messageOf(error),
      })
    }
  }

  /**
   * A cover at a size, made once and kept beside the originals in `thumbs/`.
   *
   * The originals are whatever the file carried — 1280px and 200 KB is usual —
   * and a phone keeping every cover in a library of thousands wants a fraction
   * of that. Square, cropped to the centre, as every place that draws a cover
   * draws it. The name carries the original's mtime, so replaced art makes a
   * new thumbnail; `save` drops the old ones, and `sweepThumbnails` any left.
   */
  async thumbnail(
    songId: number,
    size: number,
  ): Promise<{ path: string; contentType: string } | null> {
    const cover = await this.find(songId)
    if (!cover) return null
    const stat = await fsp.stat(cover.path)
    const dir = path.join(this.#dir, 'thumbs')
    const file = path.join(dir, `${songId}-${size}-${Math.floor(stat.mtimeMs).toString(16)}.jpg`)
    if (await isFile(file)) return { path: file, contentType: 'image/jpeg' }
    let making = this.#making.get(file)
    if (!making) {
      making = this.#makeThumbnail(songId, size, cover, file).finally(() =>
        this.#making.delete(file),
      )
      this.#making.set(file, making)
    }
    return making
  }

  /**
   * Written under a name of its own and renamed into place, so the thumbnail's
   * real name only ever holds a whole file. Written straight there, a second
   * request arriving mid-write found the name, was sent the half a JPEG it
   * held, and kept that for a week.
   */
  async #makeThumbnail(
    songId: number,
    size: number,
    cover: { path: string; contentType: string },
    file: string,
  ): Promise<{ path: string; contentType: string }> {
    const partial = `${file}.${randomUUID()}.partial`
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await sharp(cover.path)
        .rotate()
        .resize(size, size, { fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(partial)
      await fsp.rename(partial, file)
      return { path: file, contentType: 'image/jpeg' }
    } catch (error) {
      await fsp.rm(partial, { force: true }).catch(() => undefined)
      // A cover that cannot be resized is still a cover: the original is served.
      this.#logger.warn('could not make a thumbnail', {
        songId,
        size,
        message: messageOf(error),
      })
      return cover
    }
  }

  /** A kept cover, in the format `save` recorded on the row; null for none. */
  async find(songId: number): Promise<{ path: string; contentType: string } | null> {
    const extension = this.#songs.artExt(songId)
    if (extension === null) return null
    const file = this.#pathFor(songId, extension)
    if (!(await isFile(file))) return null
    return { path: file, contentType: CONTENT_TYPES[extension] ?? 'image/jpeg' }
  }

  async delete(songId: number): Promise<void> {
    for (const extension of EXTENSIONS) {
      await fsp.rm(this.#pathFor(songId, extension), { force: true }).catch(() => undefined)
    }
    await this.#dropThumbnails(songId)
  }

  /**
   * Delete every thumbnail no request would ask for: of a song with no cover
   * kept, or made from a picture since replaced. Covers replaced before
   * `save` dropped a song's thumbnails left theirs here — squared covers'
   * letterboxed ones among them. Returns how many went.
   */
  async sweepThumbnails(): Promise<number> {
    let swept = 0
    for (const name of await this.#thumbnailNames()) {
      // One being written right now.
      if (name.endsWith('.partial')) continue
      const match = /^(\d+)-\d+-([0-9a-f]+)\.jpg$/.exec(name)
      const cover = match ? await this.find(Number(match[1])) : null
      const current =
        cover !== null &&
        Math.floor((await fsp.stat(cover.path)).mtimeMs).toString(16) === match?.[2]
      if (current) continue
      await fsp.rm(path.join(this.#dir, 'thumbs', name), { force: true })
      swept++
    }
    if (swept > 0) this.#logger.info('deleted thumbnails of covers since replaced', { swept })
    return swept
  }

  /** A song's thumbnails, every size and revision. */
  async #dropThumbnails(songId: number): Promise<void> {
    for (const name of await this.#thumbnailNames()) {
      if (!name.startsWith(`${songId}-`)) continue
      await fsp.rm(path.join(this.#dir, 'thumbs', name), { force: true }).catch(() => undefined)
    }
  }

  async #thumbnailNames(): Promise<string[]> {
    try {
      return await fsp.readdir(path.join(this.#dir, 'thumbs'))
    } catch {
      // None made yet.
      return []
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

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
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
    }
  }
}

async function isFile(file: string): Promise<boolean> {
  return fsp.access(file).then(
    () => true,
    () => false,
  )
}

/** Cover art is tens of kilobytes; past this it is not cover art. */
const MAX_COVER_BYTES = 8 * 1024 * 1024
