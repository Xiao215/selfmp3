import path from 'node:path'
import { parseFile, parseBuffer, type IAudioMetadata } from 'music-metadata'
import { mimeForExtension } from '@selfmp3/shared'
import type { StorageDriver } from '../storage/index.js'
import type { Logger } from '../logger.js'

/**
 * Reading tags and cover art out of audio files.
 *
 * Every field here is best-effort. A file with no tags at all still has to
 * produce a usable song, because a lot of downloaded audio has nothing but a
 * filename — so the filename is treated as a real metadata source rather than
 * a fallback of last resort.
 */

interface ExtractedMetadata {
  title: string
  artist: string
  album: string
  albumArtist: string
  trackNo: number | null
  year: number | null
  duration: number
  picture: { data: Buffer; extension: string } | null
  /** Lyrics embedded in the file's tags, if any. */
  embeddedLyrics: string | null
}

/**
 * Parse `Artist - Title` out of a filename.
 *
 * Splits on the *first* separator, so "Artist - Song - Live" keeps the suffix
 * on the title where it belongs. Bracketed noise that download tools add is
 * stripped: "(Official Video)", "[HD]", "(Lyrics)" and friends.
 */
export function parseFilename(relativePath: string): { artist: string; title: string } {
  const base = path.basename(relativePath).replace(/\.[^.]+$/, '')

  const cleaned = base
    .replace(
      /[([][^)\]]*(?:official|video|audio|lyric|lyrics|hd|hq|mv|m\/v|live|4k)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()

  // Accept hyphen, en dash and em dash as the separator.
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleaned)
  if (match) {
    const [, artist = '', title = ''] = match
    return { artist: artist.trim(), title: title.trim() }
  }
  return { artist: '', title: cleaned || base }
}

/** YouTube auto-generated channels are named "Artist - Topic". */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\s*VEVO$/i, '')
    .trim()
}

function pictureExtension(format: string | undefined): string {
  if (!format) return '.jpg'
  const lower = format.toLowerCase()
  if (lower.includes('png')) return '.png'
  if (lower.includes('webp')) return '.webp'
  return '.jpg'
}

function firstString(values: readonly unknown[] | undefined): string | null {
  if (!values) return null
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
    if (value && typeof value === 'object' && 'text' in value) {
      const text = (value as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) return text
    }
  }
  return null
}

function fromParsed(metadata: IAudioMetadata, relativePath: string): ExtractedMetadata {
  const common = metadata.common
  const fromName = parseFilename(relativePath)

  const picture = common.picture?.[0]

  return {
    title: common.title?.trim() || fromName.title,
    artist: cleanArtist(common.artist?.trim() || fromName.artist),
    album: common.album?.trim() ?? '',
    albumArtist: common.albumartist?.trim() ?? '',
    trackNo: typeof common.track?.no === 'number' ? common.track.no : null,
    year: typeof common.year === 'number' && common.year > 0 ? common.year : null,
    duration: metadata.format.duration ?? 0,
    picture: picture
      ? { data: Buffer.from(picture.data), extension: pictureExtension(picture.format) }
      : null,
    embeddedLyrics: firstString(common.lyrics),
  }
}

/** Metadata for a file that could not be parsed at all. */
function fallback(relativePath: string): ExtractedMetadata {
  const fromName = parseFilename(relativePath)
  return {
    title: fromName.title,
    artist: fromName.artist,
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 0,
    picture: null,
    embeddedLyrics: null,
  }
}

export class MetadataService {
  readonly #storage: StorageDriver
  readonly #logger: Logger

  constructor(storage: StorageDriver, logger: Logger) {
    this.#storage = storage
    this.#logger = logger.child('metadata')
  }

  /**
   * Read metadata for one library item.
   *
   * Prefers streaming from a real path (cheap: music-metadata only reads the
   * header) and falls back to buffering the whole object when storage has no
   * local path, as with S3.
   */
  async read(key: string): Promise<ExtractedMetadata> {
    const extension = path.extname(key).toLowerCase()
    const mime = mimeForExtension(extension)

    try {
      const local = this.#storage.localPath(key)
      const parsed = local
        ? await parseFile(local, { duration: true })
        : await parseBuffer(await this.#storage.read(key), { mimeType: mime }, { duration: true })
      return fromParsed(parsed, key)
    } catch (error) {
      this.#logger.debug('could not read tags, falling back to filename', {
        key,
        message: error instanceof Error ? error.message : String(error),
      })
      return fallback(key)
    }
  }
}
