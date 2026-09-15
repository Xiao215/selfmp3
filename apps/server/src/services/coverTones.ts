import { spawn } from 'node:child_process'
import { pickCoverTone, type CoverTone } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { CoverService } from './covers.js'

/**
 * The colour of every cover, picked once, here.
 *
 * Devices draw the playing song's row and the player bars in its cover's
 * colour. A browser could read that from the image with a canvas; a phone
 * cannot, and decoding a 1280×720 cover in JavaScript there took most of a
 * second. ffmpeg draws the cover at 24×24 in milliseconds, the picking is the
 * shared arithmetic a device would have run, and the result travels with the
 * song: in the API, and in the snapshot.
 *
 * One cover at a time, in the background: once at start for the covers that
 * are already here, and again whenever one is saved.
 */

const SAMPLE = 24
const READ_TIMEOUT_MS = 15_000
/** Clients refetch the library on a change: tell them in batches on a first run. */
const BATCH = 25

export class CoverToneService {
  readonly #songs: SongRepository
  readonly #covers: CoverService
  readonly #logger: Logger
  readonly #onChange: () => void
  readonly #read: (file: string) => Promise<CoverTone | null>

  #running = false
  #stopped = false

  constructor(deps: {
    songs: SongRepository
    covers: CoverService
    logger: Logger
    /** Called every few covers, and once when there are none left. */
    onChange: () => void
    /** How a cover file becomes a colour. ffmpeg, except in the tests. */
    read?: (file: string) => Promise<CoverTone | null>
  }) {
    this.#songs = deps.songs
    this.#covers = deps.covers
    this.#logger = deps.logger.child('cover-tones')
    this.#onChange = deps.onChange
    this.#read = deps.read ?? readCoverTone
  }

  /**
   * Look for covers to read. Safe to call as often as you like: a run already
   * going asks the database for the next cover each time round, so it finds
   * one saved meanwhile without being told.
   */
  kick(): void {
    if (this.#stopped || this.#running) return
    void this.#drain()
  }

  stop(): void {
    this.#stopped = true
  }

  async #drain(): Promise<void> {
    this.#running = true
    let done = 0
    try {
      while (!this.#stopped) {
        const next = this.#songs.nextWithoutCoverTone()
        if (!next) break

        let tone: CoverTone | null = null
        const found = this.#covers.find(next.id)
        if (found) {
          try {
            tone = await this.#read(found.path)
          } catch (error) {
            this.#logger.warn('could not read a cover’s colour', {
              songId: next.id,
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
        // Kept even when there is none, against this revision of the cover,
        // so a cover that cannot be read is not read again until it changes.
        this.#songs.setCoverTone(next.id, next.artRev, tone)
        done++
        if (done % BATCH === 0) this.#onChange()
      }
    } finally {
      this.#running = false
    }
    if (done % BATCH !== 0) this.#onChange()
    if (done > 0) this.#logger.debug('cover colours read', { covers: done })
  }
}

/**
 * A cover file's colour: ffmpeg draws its centre square at 24×24, and the
 * shared picking decides.
 *
 * The centre square because that is the cover every screen shows: rows, the
 * player bar and Now Playing all draw it square, cropped, and the app's kept
 * thumbnail is that crop. Squashed whole, a 1280×720 video still read its grey
 * sides as most of the picture — Plagiarism's collage came out colourless here
 * while a device reading the square it drew found orange, so the visual and
 * the bar coloured the same song differently.
 */
export function readCoverTone(file: string): Promise<CoverTone | null> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `crop=w='min(iw,ih)':h='min(iw,ih)',scale=${SAMPLE}:${SAMPLE}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      'pipe:1',
    ]
    const child = spawn('ffmpeg', args, { shell: false, windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    let settled = false

    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(pickCoverTone(Buffer.concat(chunks)))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('ffmpeg timed out reading the cover'))
    }, READ_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', error => finish(new Error(`could not run ffmpeg: ${error.message}`)))
    child.on('close', code => {
      if (code === 0) finish(null)
      else finish(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`))
    })
  })
}
