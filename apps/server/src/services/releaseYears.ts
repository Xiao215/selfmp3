import { youtubeVideoId } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SongRepository } from '../repositories/songs.js'
import type { LocalEdits } from './localEdits.js'
import { findAll, findKey, runs, WEB_CLIENT, YouTubeMusicApi } from './youtubeMusicApi.js'
import { AUDIO_TRACK } from './youtubeMusicSongs.js'

/**
 * The year each song already here came out, asked once.
 *
 * Downloads used to carry the day the video went up on YouTube as their year,
 * and a label puts its catalogue up long after: 晴天 (2003) read 2019, and
 * every song in the library read 2014 or later. Downloads carry the release
 * date now (ytdlp.ts); this mends the songs downloaded before that.
 *
 * YouTube Music's `next` on a song's own video names it as "周杰倫 • 葉惠美 •
 * 2003": the album's year, for exactly the track that was downloaded, with no
 * matching to get wrong. It is the API the timed lyrics already use, not
 * yt-dlp, so it spends none of the download budget (ytThrottle.ts).
 *
 * The songs to ask about are a table the migration filled
 * (`release_years_to_check`), and a song leaves it once it is answered, so a
 * restart carries on where the last run stopped and a finished pass is never
 * run again. Songs left unanswered — YouTube Music down, the network away —
 * are asked again half an hour later, without waiting for a restart. A new year is an ordinary edit, stamped, so it syncs to every
 * device and the bucket like one typed by hand; a year that was typed by hand
 * is left as it is.
 */

/** Between two asks: a whole library takes minutes, and YouTube sees a listener, not a crawl. */
const GAP_MS = 300
/** Clients refetch the library on a change: tell them in batches. */
const BATCH = 25
/** Asks in a row that got no answer at all: the network is down, so stop for now. */
const GIVE_UP_AFTER = 5
/** How long until the songs left unanswered are asked about again. */
const RETRY_MS = 30 * 60 * 1000
/** Rounds a song may go unanswered while others are answered before it is let go. */
const LET_GO_AFTER = 3

/**
 * The year YouTube Music gives the song at `videoId`, from a `next` response.
 *
 * Only for an audio track: that is a release, and its line ends with the
 * release's year. A music video's line is the channel and its views.
 */
export function releaseYearOf(response: unknown, videoId: string, now = new Date()): number | null {
  const renderer = findAll(response, 'playlistPanelVideoRenderer').find(
    item => (item as { videoId?: unknown }).videoId === videoId,
  )
  if (!renderer || findKey(renderer, 'musicVideoType') !== AUDIO_TRACK) return null
  const last = runs((renderer as { longBylineText?: unknown }).longBylineText)
    .join('')
    .split(' • ')
    .at(-1)
    ?.trim()
  if (!last || !/^\d{4}$/.test(last)) return null
  const year = Number(last)
  return year >= 1900 && year <= now.getFullYear() + 1 ? year : null
}

export class ReleaseYearService {
  readonly #songs: SongRepository
  readonly #edits: LocalEdits
  readonly #api: YouTubeMusicApi
  readonly #logger: Logger
  readonly #onChange: () => void
  readonly #gapMs: number
  readonly #retryMs: number
  /** Rounds each song has gone unanswered while others were answered. */
  readonly #misses = new Map<number, number>()

  #running = false
  #stopped = false
  #retry: NodeJS.Timeout | null = null

  constructor(deps: {
    songs: SongRepository
    edits: LocalEdits
    logger: Logger
    /** Called every few changed years, and once at the end. */
    onChange: () => void
    api?: YouTubeMusicApi
    gapMs?: number
    retryMs?: number
  }) {
    this.#songs = deps.songs
    this.#edits = deps.edits
    this.#logger = deps.logger.child('release-years')
    this.#api = deps.api ?? new YouTubeMusicApi(deps.logger)
    this.#onChange = deps.onChange
    this.#gapMs = deps.gapMs ?? GAP_MS
    this.#retryMs = deps.retryMs ?? RETRY_MS
  }

  /**
   * Work through the songs still to ask about. Does nothing once there are
   * none; while some are left unanswered, it tries again by itself.
   */
  start(): Promise<void> {
    if (this.#stopped || this.#running) return Promise.resolve()
    return this.#drain()
  }

  stop(): void {
    this.#stopped = true
    if (this.#retry) clearTimeout(this.#retry)
    this.#retry = null
  }

  async #drain(): Promise<void> {
    this.#running = true
    let after = 0
    let asked = 0
    let changed = 0
    let unanswered = 0
    let gaveUp = false
    const missed: number[] = []
    try {
      for (;;) {
        if (this.#stopped) break
        const next = this.#songs.nextYearToCheck(after)
        if (!next) break
        after = next.id

        const videoId = youtubeVideoId(next.sourceUrl)
        if (next.edited || !videoId) {
          this.#songs.yearChecked(next.id)
          continue
        }

        if (asked > 0) await new Promise(resolve => setTimeout(resolve, this.#gapMs))
        asked++
        const response = await this.#api.post('next', { videoId, isAudioOnly: true }, WEB_CLIENT)
        // Nothing to say is an answer; no reply is not, and the song is asked again.
        if (!response) {
          missed.push(next.id)
          if (++unanswered >= GIVE_UP_AFTER) {
            gaveUp = true
            break
          }
          continue
        }
        unanswered = 0

        const year = releaseYearOf(response, videoId)
        if (year !== null && year !== next.year) {
          this.#songs.patch(next.id, { year })
          this.#edits.songs([next.id], ['year'])
          changed++
          if (changed % BATCH === 0) this.#onChange()
        }
        this.#songs.yearChecked(next.id)
      }
    } finally {
      this.#running = false
    }
    if (changed % BATCH !== 0) this.#onChange()
    if (asked > 0) this.#logger.info('release years checked', { asked, changed, gaveUp })

    // A round that stopped for the network says nothing about its songs. In
    // one that went the whole way, a song nobody answered while the rest were
    // answered is counted, and after a few such rounds it is let go.
    if (!gaveUp) {
      for (const id of missed) {
        const misses = (this.#misses.get(id) ?? 0) + 1
        if (misses < LET_GO_AFTER) {
          this.#misses.set(id, misses)
          continue
        }
        this.#misses.delete(id)
        this.#songs.yearChecked(id)
      }
    }

    if (this.#stopped || !this.#songs.nextYearToCheck(0)) return
    this.#logger.info('some songs went unanswered; asking again later', {
      minutes: Math.round(this.#retryMs / 60_000),
    })
    this.#retry = setTimeout(() => {
      this.#retry = null
      void this.start()
    }, this.#retryMs)
    this.#retry.unref()
  }
}
