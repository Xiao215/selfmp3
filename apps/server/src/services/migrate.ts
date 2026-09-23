import crypto from 'node:crypto'
import type {
  MigrateMatchItem,
  MigrateMatchJob,
  MigrateParseResult,
  MigrateSourceTrack,
} from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { YtDlpService } from './ytdlp.js'
import { parseSpotifyEmbed, parseTrackList, spotifyPlaylistId } from './migrateParse.js'
import { rankCandidates, searchQuery } from './migrateScore.js'
import { alreadyHave as alreadyInLibrary, type LibrarySong } from './alreadyHave.js'

/**
 * Playlist migration.
 *
 * Parsing is synchronous; matching is a job that searches YouTube once per
 * track with a few searches in flight at a time. Jobs live in memory only —
 * unlike the download queue there is nothing to resume after a restart, the
 * results are just suggestions the user has not committed to yet, and a
 * fifty-song search redone from scratch costs minutes rather than a download.
 *
 * The searches go through YtDlpService like every other request to YouTube,
 * so they spend the same budget as the download queue and a bot wall met here
 * pauses it too (services/ytThrottle.ts).
 */

/** How many searches run at once. The throttle paces them; this just bounds the burst. */
const SEARCH_CONCURRENCY = 3
/** Results per search; the top three after scoring are shown. */
const SEARCH_RESULTS = 5
/** Forget finished jobs after this long. */
const JOB_TTL_MS = 60 * 60 * 1000
const SPOTIFY_TIMEOUT_MS = 15_000

interface StoredJob {
  job: MigrateMatchJob
  controller: AbortController
  finishedAt: number | null
}

export class MigrateService {
  readonly #songs: Pick<SongRepository, 'all'>
  readonly #logger: Logger
  readonly #ytdlp: Pick<YtDlpService, 'search'>
  readonly #jobs = new Map<string, StoredJob>()

  constructor(deps: {
    songs: Pick<SongRepository, 'all'>
    logger: Logger
    ytdlp: Pick<YtDlpService, 'search'>
  }) {
    this.#songs = deps.songs
    this.#logger = deps.logger.child('migrate')
    this.#ytdlp = deps.ytdlp
  }

  /** Text, CSV or a Spotify link → tracks. Only the Spotify path touches the network. */
  async parse(text: string): Promise<MigrateParseResult> {
    const playlistId = spotifyPlaylistId(text)
    if (!playlistId) return parseTrackList(text)

    const html = await this.#fetchSpotifyEmbed(playlistId)
    const parsed = parseSpotifyEmbed(html)
    if (!parsed || parsed.tracks.length === 0) {
      throw new Error(
        'could not read that Spotify playlist (it may be private or the page changed). ' +
          'Paste the tracks as text instead, or export a CSV with exportify.net and paste that.',
      )
    }
    return parsed
  }

  async #fetchSpotifyEmbed(playlistId: string): Promise<string> {
    try {
      const response = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
        signal: AbortSignal.timeout(SPOTIFY_TIMEOUT_MS),
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) self.mp3', accept: 'text/html' },
      })
      if (!response.ok) throw new Error(`Spotify answered ${response.status}`)
      return await response.text()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#logger.warn('spotify fetch failed', { playlistId, message })
      throw new Error(
        `could not reach Spotify (${message}). Paste the tracks as text instead, or export a ` +
          'CSV with exportify.net and paste that.',
      )
    }
  }

  /** Start matching; returns at once with the job id. */
  startMatch(tracks: readonly MigrateSourceTrack[]): MigrateMatchJob {
    this.#prune()
    const job: MigrateMatchJob = {
      id: crypto.randomUUID(),
      status: 'running',
      total: tracks.length,
      completed: 0,
      items: tracks.map(() => null),
    }
    const stored: StoredJob = { job, controller: new AbortController(), finishedAt: null }
    this.#jobs.set(job.id, stored)
    void this.#runMatch(stored, tracks)
    return job
  }

  job(id: string): MigrateMatchJob | null {
    return this.#jobs.get(id)?.job ?? null
  }

  cancel(id: string): boolean {
    const stored = this.#jobs.get(id)
    if (!stored || stored.job.status !== 'running') return false
    stored.controller.abort()
    stored.job.status = 'cancelled'
    stored.finishedAt = Date.now()
    return true
  }

  stop(): void {
    for (const stored of this.#jobs.values()) stored.controller.abort()
  }

  async #runMatch(stored: StoredJob, tracks: readonly MigrateSourceTrack[]): Promise<void> {
    const { job, controller } = stored
    // Snapshot once: fifty fuzzy scans of a changing list would be pointless work.
    // Length and source link as well as the name: a migrated list is matched
    // against the library by the same rule a pasted link is (alreadyHave.ts).
    const library: LibrarySong[] = this.#songs
      .all()
      .map(song => ({ title: song.title, artist: song.artist, duration: song.duration }))

    let next = 0
    const worker = async (): Promise<void> => {
      while (next < tracks.length && !controller.signal.aborted) {
        const index = next++
        const source = tracks[index] as MigrateSourceTrack
        const item = await this.#matchOne(source, library, controller.signal)
        if (controller.signal.aborted) return
        job.items[index] = item
        job.completed++
      }
    }

    await Promise.all(Array.from({ length: SEARCH_CONCURRENCY }, () => worker()))

    if (job.status === 'running') job.status = 'done'
    stored.finishedAt = Date.now()
    this.#logger.info('match finished', { id: job.id, total: job.total, status: job.status })
  }

  async #matchOne(
    source: MigrateSourceTrack,
    library: readonly LibrarySong[],
    signal: AbortSignal,
  ): Promise<MigrateMatchItem> {
    const alreadyHave = alreadyInLibrary(source, library) !== null
    try {
      const hits = await this.#ytdlp.search(searchQuery(source), SEARCH_RESULTS, signal)
      return { source, candidates: rankCandidates(source, hits), alreadyHave, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#logger.warn('search failed', { title: source.title, message })
      return { source, candidates: [], alreadyHave, error: message }
    }
  }

  #prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, stored] of this.#jobs) {
      if (stored.finishedAt !== null && stored.finishedAt < cutoff) this.#jobs.delete(id)
    }
  }
}
