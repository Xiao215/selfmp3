import fsp from 'node:fs/promises'
import path from 'node:path'
import { messageOf } from '@selfmp3/shared'
import { fetchPublic } from '../http/publicWeb.js'
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

/** A cover's bytes from the open web, as `fetchPublic` gives them. */
type CoverDownload = (url: string) => Promise<{ contentType: string; data: Buffer | null } | null>

export class TagWriter {
  readonly #download: CoverDownload
  readonly #logger: Logger

  constructor(deps: { download?: CoverDownload; logger: Logger }) {
    /*
     * The address is the client's — the review's thumbnail — so it is
     * fetched as covers.ts fetches one: from the open web only, never this
     * machine, the home network or the tailnet, every redirect checked, and
     * no more read than any cover is.
     */
    this.#download =
      deps.download ??
      (url => fetchPublic(url, { signal: AbortSignal.timeout(15_000), limit: MAX_COVER_BYTES }))
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
      let result = await run('ffmpeg', tagArgs(file, output, tags, cover), { timeoutMs: 60_000 })
      // A picture ffmpeg cannot read (a page that answered 200, a format it does not take): the tags go in without it.
      if (result.code !== 0 && cover) {
        this.#logger.debug('the cover would not go in; tagging without it', { file })
        result = await run('ffmpeg', tagArgs(file, output, tags, null), { timeoutMs: 60_000 })
      }
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
    try {
      const got = await this.#download(url)
      if (!got?.data || got.data.length === 0) return null
      // ffmpeg tells the picture's format by its bytes; the name only has to be one.
      const file = `${base}${path.extname(new URL(url).pathname) || '.jpg'}`
      await fsp.writeFile(file, got.data)
      return file
    } catch (error) {
      this.#logger.debug('no cover for a file', { url, message: messageOf(error) })
      return null
    }
  }
}
