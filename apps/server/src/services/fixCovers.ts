import type { FixCoversStatus, Song } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { CoverService } from './covers.js'
import type { MetadataLookupService } from './lookup.js'
import { CONFIDENT_SCORE } from './lookupScore.js'

/**
 * The background "find missing cover art" pass.
 *
 * Walks every song without art, asks the lookup service, and stores artwork
 * only from a candidate confident enough that a wrong cover is unlikely — a
 * missing cover is a placeholder gradient, a wrong one is actively misleading.
 * One song at a time, because MusicBrainz rate-limits us anyway and the pass
 * runs while the user carries on listening.
 *
 * State is in memory: the pass is idempotent (it only ever looks at songs that
 * still lack art), so a restart mid-way loses nothing but the progress line.
 */
export class FixCoversService {
  readonly #songs: SongRepository
  readonly #covers: CoverService
  readonly #lookup: MetadataLookupService
  readonly #logger: Logger
  readonly #onChange: () => void

  #status: FixCoversStatus = {
    status: 'idle',
    total: 0,
    done: 0,
    found: 0,
    currentTitle: null,
    startedAt: null,
    finishedAt: null,
  }
  #cancelled = false

  constructor(deps: {
    songs: SongRepository
    covers: CoverService
    lookup: MetadataLookupService
    logger: Logger
    /** Called whenever a cover lands, so clients refetch the library. */
    onChange: () => void
  }) {
    this.#songs = deps.songs
    this.#covers = deps.covers
    this.#lookup = deps.lookup
    this.#logger = deps.logger.child('fix-covers')
    this.#onChange = deps.onChange
  }

  status(): FixCoversStatus {
    return this.#status
  }

  /** Begin a pass, or return the current one if it is already running. */
  start(): FixCoversStatus {
    if (this.#status.status === 'running') return this.#status

    const pending = this.#songs.withoutArt()
    this.#cancelled = false
    this.#status = {
      status: 'running',
      total: pending.length,
      done: 0,
      found: 0,
      currentTitle: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }
    void this.#run(pending)
    return this.#status
  }

  cancel(): FixCoversStatus {
    if (this.#status.status === 'running') this.#cancelled = true
    return this.#status
  }

  async #run(pending: Song[]): Promise<void> {
    for (const song of pending) {
      if (this.#cancelled) break
      this.#status = { ...this.#status, currentTitle: song.title }
      try {
        if (await this.#fixOne(song)) {
          this.#status = { ...this.#status, found: this.#status.found + 1 }
          this.#onChange()
        }
      } catch (error) {
        // One bad song must not stop the pass for the other nine hundred.
        this.#logger.warn('cover lookup failed', {
          songId: song.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      this.#status = { ...this.#status, done: this.#status.done + 1 }
    }

    this.#status = {
      ...this.#status,
      status: this.#cancelled ? 'cancelled' : 'done',
      currentTitle: null,
      finishedAt: new Date().toISOString(),
    }
    this.#logger.info('cover art pass finished', {
      found: this.#status.found,
      done: this.#status.done,
      total: this.#status.total,
    })
  }

  /** True when artwork was stored for this song. */
  async #fixOne(song: Song): Promise<boolean> {
    const candidates = await this.#lookup.lookup({
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
    })
    // Candidates arrive best-first; try each confident one until a download
    // sticks, since an artwork URL can still 404 by the time we fetch it.
    for (const candidate of candidates) {
      if (candidate.score < CONFIDENT_SCORE) break
      if (!candidate.artworkUrl) continue
      if (await this.#covers.saveFromUrl(song.id, candidate.artworkUrl)) {
        this.#logger.debug('stored cover art', { songId: song.id, source: candidate.source })
        return true
      }
    }
    return false
  }
}
