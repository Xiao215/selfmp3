import fsp from 'node:fs/promises'
import { messageOf } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { FetchedCover } from './covers.js'
import { runFfmpeg } from './ffmpeg.js'

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
    // Read as a picture and nothing else: ffmpeg otherwise picks a reader by the
    // name or the bytes, and a playlist or a concat list reads other files.
    ...(cover ? ['-f', 'image2', '-i', cover, '-map', '0:a', '-map', '1:v'] : ['-map', '0:a']),
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
  readonly #logger: Logger

  constructor(deps: { logger: Logger }) {
    this.#logger = deps.logger.child('tags')
  }

  /**
   * Tag `file` in place, with `cover` inside it — fetched by the caller
   * (covers.ts `fetchFromUrl`), which keeps the same picture as the song's
   * cover. Returns whether the file was tagged; a false is logged, not thrown.
   */
  async write(file: string, tags: FileTags, cover: FetchedCover | null): Promise<boolean> {
    const output = `${file}.tagged`
    const picture = cover ? `${file}.cover${cover.extension}` : null
    try {
      if (cover && picture) await fsp.writeFile(picture, cover.data)
      let result = await runFfmpeg(tagArgs(file, output, tags, picture), TAG_RUN)
      // A picture ffmpeg cannot read (a page that answered 200, a format it does not take): the tags go in without it.
      if (result.code !== 0 && picture) {
        this.#logger.debug('the cover would not go in; tagging without it', { file })
        result = await runFfmpeg(tagArgs(file, output, tags, null), TAG_RUN)
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
      if (picture) await fsp.rm(picture, { force: true }).catch(() => undefined)
    }
  }
}

/** One tagging run: a copy of the audio, so a minute is far more than it needs. */
const TAG_RUN = { timeoutMs: 60_000, timeoutMessage: 'ffmpeg took too long tagging a file' }
