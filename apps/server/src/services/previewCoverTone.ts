import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoverTone } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { readCoverTone } from './coverTones.js'

/**
 * The colour of a cover the library does not hold yet: a song on the import
 * review, playing before it is imported.
 *
 * The review draws the row it is playing in its cover's colour, as the
 * library's rows are drawn. A library song's colour is picked here once and
 * sent with the song (coverTones.ts); a review's song has no such record, and
 * a phone cannot read the picture's pixels itself. So the picture is fetched
 * here and read the same way — ffmpeg at 24×24, the shared arithmetic — and
 * remembered by its address for the rest of the run, so a song played twice
 * is read once.
 *
 * Only a picture from where YouTube and YouTube Music keep covers is fetched:
 * this is a server asked for an address by a client, and it will not be made
 * to fetch anything else.
 */

const COVER_HOSTS = [/(^|\.)ytimg\.com$/, /(^|\.)googleusercontent\.com$/, /(^|\.)ggpht\.com$/]
const MAX_BYTES = 4 << 20
const FETCH_TIMEOUT_MS = 8_000
/** How many covers are remembered; the oldest is let go when there is one more. */
const REMEMBERED = 500

/** Whether `url` is a cover from YouTube's own picture hosts, over https. */
export function isCoverUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return COVER_HOSTS.some(pattern => pattern.test(host))
}

export class PreviewCoverTones {
  readonly #logger: Logger
  readonly #fetch: typeof fetch
  readonly #read: (file: string) => Promise<CoverTone | null>
  readonly #tones = new Map<string, CoverTone | null>()
  readonly #pending = new Map<string, Promise<CoverTone | null>>()

  constructor(deps: {
    logger: Logger
    fetch?: typeof fetch
    /** How a picture on disk becomes a colour. ffmpeg, except in the tests. */
    read?: (file: string) => Promise<CoverTone | null>
  }) {
    this.#logger = deps.logger.child('preview-cover-tones')
    this.#fetch = deps.fetch ?? fetch
    this.#read = deps.read ?? readCoverTone
  }

  /**
   * The cover's colour, or null when it has none or could not be read. A
   * failure is not remembered, so the next ask tries again; two asks in the
   * same moment share one read.
   */
  async tone(url: string): Promise<CoverTone | null> {
    const known = this.#tones.get(url)
    if (known !== undefined) return known
    const pending = this.#pending.get(url)
    if (pending) return pending

    const reading = this.#readUrl(url).finally(() => this.#pending.delete(url))
    this.#pending.set(url, reading)
    return reading
  }

  async #readUrl(url: string): Promise<CoverTone | null> {
    let tone: CoverTone | null
    try {
      tone = await this.#pick(url)
    } catch (error) {
      this.#logger.debug('could not read a cover’s colour', {
        url,
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
    this.#tones.set(url, tone)
    if (this.#tones.size > REMEMBERED) {
      const oldest = this.#tones.keys().next().value
      if (oldest !== undefined) this.#tones.delete(oldest)
    }
    return tone
  }

  async #pick(url: string): Promise<CoverTone | null> {
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`the picture answered ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new Error('the picture is too large to be a cover')

    // ffmpeg reads a file; the picture is one for as long as that takes.
    const dir = await mkdtemp(join(tmpdir(), 'selfmp3-cover-'))
    try {
      const file = join(dir, 'cover')
      await writeFile(file, bytes)
      return await this.#read(file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}
