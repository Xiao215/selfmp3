import fsp from 'node:fs/promises'
import path from 'node:path'
import { messageOf } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { run } from './ytdlp.js'

/**
 * Tags for a file the server did not download itself.
 *
 * A download of the server's own comes out of yt-dlp tagged: the title, the
 * artist, the album and the release date, and the cover inside it
 * (`--embed-metadata --embed-thumbnail`, services/ytdlp.ts). A file a device
 * downloaded (docs/features/client-download.md) comes straight off YouTube's
 * media servers with none of that, so this writes it with ffmpeg — from what
 * the person confirmed in the review rather than from YouTube's listing,
 * which is what the library shows anyway.
 *
 * Nothing here fails an import. A file that cannot be tagged is still the
 * song, and the library has its title and cover either way; it only means the
 * file, taken out of the library, says less about itself.
 */

export interface FileTags {
  readonly title: string
  readonly artist: string
  readonly album: string
  /** `YYYY-MM-DD` or `YYYY`, or null to leave the date out. */
  readonly date: string | null
}

/** A cover is a picture of a few hundred kilobytes; anything far past that is not one. */
const MAX_COVER_BYTES = 10 * 1024 * 1024

/**
 * ffmpeg's arguments to copy `input` to `output` with `tags`, and `cover`
 * inside it when there is one. The audio is copied as it is; the cover is
 * made a JPEG whatever it came as, since an m4a carries JPEG or PNG and a
 * YouTube thumbnail can be WebP.
 */
export function tagArgs(
  input: string,
  output: string,
  tags: FileTags,
  cover: string | null,
): string[] {
  const metadata = [
    ['title', tags.title],
    ['artist', tags.artist],
    ['album', tags.album],
    ['date', tags.date ?? ''],
  ].flatMap(([key, value]) => (value ? ['-metadata', `${key}=${value}`] : []))
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    ...(cover ? ['-i', cover, '-map', '0:a', '-map', '1:v'] : ['-map', '0:a']),
    '-c:a',
    'copy',
    ...(cover ? ['-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic'] : []),
    ...metadata,
    '-f',
    'mp4',
    output,
  ]
}

export class TagWriter {
  readonly #fetch: typeof fetch
  readonly #logger: Logger

  constructor(deps: { fetch?: typeof fetch; logger: Logger }) {
    this.#fetch = deps.fetch ?? fetch
    this.#logger = deps.logger.child('tags')
  }

  /**
   * Tag `file` in place, with the picture at `coverUrl` inside it. Returns
   * whether the file was tagged; a false is logged, not thrown.
   */
  async write(file: string, tags: FileTags, coverUrl: string | null): Promise<boolean> {
    const output = `${file}.tagged`
    const cover = coverUrl ? await this.#fetchCover(coverUrl, `${file}.cover`) : null
    try {
      const result = await run('ffmpeg', tagArgs(file, output, tags, cover), { timeoutMs: 60_000 })
      if (result.code !== 0) {
        this.#logger.warn('could not tag a file', { file, stderr: result.stderr.slice(-400) })
        return false
      }
      await fsp.rename(output, file)
      return true
    } catch (error) {
      this.#logger.warn('could not tag a file', { file, message: messageOf(error) })
      return false
    } finally {
      await fsp.rm(output, { force: true }).catch(() => undefined)
      if (cover) await fsp.rm(cover, { force: true }).catch(() => undefined)
    }
  }

  /** The picture at `url`, written beside the file, or null when it did not come. */
  async #fetchCover(url: string, base: string): Promise<string | null> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    try {
      const response = await this.#fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) {
        await response.body?.cancel()
        return null
      }
      const bytes = await readCapped(response, MAX_COVER_BYTES)
      if (!bytes || bytes.length === 0) return null
      // ffmpeg tells the picture's format by its bytes; the name only has to be one.
      const file = `${base}${path.extname(parsed.pathname) || '.jpg'}`
      await fsp.writeFile(file, bytes)
      return file
    } catch (error) {
      this.#logger.debug('no cover for a file', { url, message: messageOf(error) })
      return null
    }
  }
}

/**
 * A response's body, or null once it is past `max` bytes: by its
 * `content-length` before anything is read, as covers.ts asks, and by what
 * has come so far for one that does not say — the rest is not read.
 */
async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined
  if (!reader) return new Uint8Array(0)
  const parts: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > max) {
      await reader.cancel()
      return null
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}
