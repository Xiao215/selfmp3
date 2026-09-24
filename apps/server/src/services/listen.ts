import type { YtDlpService } from './ytdlp.js'

/**
 * Listening to a track before importing it.
 *
 * yt-dlp names where a track's audio lives on YouTube's servers, but that link
 * only works from the machine that asked for it — this one. So the audio comes
 * through here rather than the browser fetching it, which is also what makes
 * it work from a phone away from home.
 *
 * Each link is good for hours and is kept: dragging the playhead around is a
 * new range request every time, and should cost one yt-dlp run per track,
 * not one per seek. Two requests at once for the same track — Safari asks for
 * the first two bytes before the rest — share one run.
 */

/** Links are dropped this long before YouTube says they expire. */
const EXPIRY_MARGIN_MS = 10 * 60 * 1000
/** For a link that does not say when it expires. */
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000
/** Enough for a long review session; the oldest go first. */
const MAX_ENTRIES = 200

interface Entry {
  readonly url: string
  readonly expiresAt: number
}

export class ListenService {
  readonly #ytdlp: Pick<YtDlpService, 'audioUrl'>
  readonly #now: () => number
  readonly #links = new Map<string, Entry>()
  readonly #pending = new Map<string, Promise<string>>()

  constructor(ytdlp: Pick<YtDlpService, 'audioUrl'>, now: () => number = Date.now) {
    this.#ytdlp = ytdlp
    this.#now = now
  }

  /** Where the track's audio can be fetched from right now. */
  async source(trackUrl: string): Promise<string> {
    const known = this.#links.get(trackUrl)
    if (known && known.expiresAt > this.#now()) return known.url

    const pending = this.#pending.get(trackUrl)
    if (pending) return pending

    const lookup = this.#ytdlp
      .audioUrl(trackUrl)
      .then(url => {
        this.#remember(trackUrl, url)
        return url
      })
      .finally(() => this.#pending.delete(trackUrl))
    this.#pending.set(trackUrl, lookup)
    return lookup
  }

  /**
   * Look the links up now, so the first tap on a review does not pay for it.
   *
   * The lookup is the one fixed cost of a preview — a couple of seconds of
   * yt-dlp before a single byte plays — and a review's first rows are the ones
   * somebody is about to press. Each is a request against the YouTube budget
   * (ytThrottle.ts), which is why it is a few and not the whole list; a tap
   * that lands while a lookup is running shares it, as `source` always has.
   * Nothing here is waited on, and a link that cannot be read says so when
   * it is played, not now.
   */
  warm(trackUrls: readonly string[]): void {
    for (const trackUrl of trackUrls) {
      this.source(trackUrl).catch(() => undefined)
    }
  }

  /** YouTube turned the link down after all: look it up afresh next time. */
  forget(trackUrl: string): void {
    this.#links.delete(trackUrl)
  }

  #remember(trackUrl: string, url: string): void {
    const expire = Number(new URL(url).searchParams.get('expire'))
    const expiresAt =
      expire > 0 ? expire * 1000 - EXPIRY_MARGIN_MS : this.#now() + DEFAULT_LIFETIME_MS

    this.#links.delete(trackUrl)
    this.#links.set(trackUrl, { url, expiresAt })
    if (this.#links.size > MAX_ENTRIES) {
      const oldest = this.#links.keys().next().value
      if (oldest !== undefined) this.#links.delete(oldest)
    }
  }
}
