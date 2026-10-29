import path from 'node:path'
import { parseFromTokenizer, type IAudioMetadata } from 'music-metadata'
import { fromFile } from 'strtok3'
import { messageOf, cleanArtist, tidyText } from '@selfmp3/shared'
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
  const base = tidyText(path.basename(relativePath).replace(/\.[^.]+$/, ''))

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

  // Tidied as a name typed in is (shared `tidyText`): a file's tags can carry
  // line breaks and invisible or direction-changing characters as well.
  return {
    title: tidyText(common.title ?? '') || fromName.title,
    artist: cleanArtist(tidyText(common.artist ?? '') || fromName.artist),
    album: tidyText(common.album ?? ''),
    albumArtist: tidyText(common.albumartist ?? ''),
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

/**
 * How long one file's tags may take. A whole file reads in a second or two,
 * even an hour of VBR audio counted frame by frame; past this something is
 * wrong with the reading, not slow (`MetadataService.read`).
 */
const READ_LIMIT_MS = 60_000

/** A file whose tags were still being read when `READ_LIMIT_MS` ran out. */
class ReadTooLong extends Error {}

export class MetadataService {
  readonly #storage: StorageDriver
  readonly #logger: Logger
  readonly #limitMs: number

  constructor(storage: StorageDriver, logger: Logger, options: { limitMs?: number } = {}) {
    this.#storage = storage
    this.#logger = logger.child('metadata')
    this.#limitMs = options.limitMs ?? READ_LIMIT_MS
  }

  /**
   * Read metadata for one library item.
   *
   * Read from the file's real path, which is cheap: music-metadata only reads
   * the header.
   *
   * Time-limited, and stopped for real when the time runs out: the file is
   * closed under the reader. music-metadata takes the file's size once, when
   * it opens it, and a file still being written grows past that; reading past
   * the size it took, it counts its place backwards and goes round the same
   * frames for ever, a core of the CPU busy and the sweep waiting on it with
   * every sweep after it (bug bash R3-M3). A file that ran out of time throws
   * rather than reading as a file with no tags, so it is tried again whole
   * by the next sweep instead of being kept as a song with no length.
   */
  async read(key: string): Promise<ExtractedMetadata> {
    let tokenizer: Awaited<ReturnType<typeof fromFile>>
    try {
      tokenizer = await fromFile(this.#storage.localPath(key), { regularFileOnly: true })
    } catch (error) {
      return this.#fallback(key, error)
    }
    let tooLong = false
    const limit = setTimeout(() => {
      tooLong = true
      tokenizer.close().catch(() => undefined)
    }, this.#limitMs)
    try {
      return fromParsed(await parseFromTokenizer(tokenizer, { duration: true }), key)
    } catch (error) {
      if (tooLong) throw new ReadTooLong(`reading ${key} took longer than ${this.#limitMs} ms`)
      return this.#fallback(key, error)
    } finally {
      clearTimeout(limit)
      if (!tooLong) await tokenizer.close().catch(() => undefined)
    }
  }

  #fallback(key: string, error: unknown): ExtractedMetadata {
    this.#logger.debug('could not read tags, falling back to filename', {
      key,
      message: messageOf(error),
    })
    return fallback(key)
  }
}
