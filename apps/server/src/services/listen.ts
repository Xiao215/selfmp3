import type { FoundAudio, YtDlpService } from './ytdlp.js'

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
 *
 * Nothing is looked up before someone presses play: most reviews are imported
 * without a listen, and each lookup is a request to YouTube and seconds of a
 * Pi's time. A link found for a listen is kept for the import that may follow
 * (`known`), so a song heard and then imported is looked up once.
 */

/** Links are dropped this long before YouTube says they expire. */
const EXPIRY_MARGIN_MS = 10 * 60 * 1000
/** For a link that does not say when it expires. */
const DEFAULT_LIFETIME_MS = 60 * 60 * 1000
/** Enough for a long review session; the oldest go first. */
const MAX_ENTRIES = 200

interface Entry {
  readonly found: FoundAudio
  readonly expiresAt: number
}

export class ListenService {
  readonly #ytdlp: Pick<YtDlpService, 'findAudio'>
  readonly #now: () => number
  readonly #links = new Map<string, Entry>()
  readonly #pending = new Map<string, Promise<FoundAudio>>()

  constructor(ytdlp: Pick<YtDlpService, 'findAudio'>, now: () => number = Date.now) {
    this.#ytdlp = ytdlp
    this.#now = now
  }

  /** Where the track's audio can be fetched from right now. */
  async source(trackUrl: string): Promise<FoundAudio> {
    const known = this.known(trackUrl)
    if (known) return known

    const pending = this.#pending.get(trackUrl)
    if (pending) return pending

    const lookup = this.#ytdlp
      .findAudio(trackUrl)
      .then(found => {
        this.#remember(trackUrl, found)
        return found
      })
      .finally(() => this.#pending.delete(trackUrl))
    this.#pending.set(trackUrl, lookup)
    return lookup
  }

  /** The track's audio if a listen already found it and the link is still good; never asks. */
  known(trackUrl: string): FoundAudio | null {
    const entry = this.#links.get(trackUrl)
    return entry && entry.expiresAt > this.#now() ? entry.found : null
  }

  /** YouTube turned the link down after all: look it up afresh next time. */
  forget(trackUrl: string): void {
    this.#links.delete(trackUrl)
  }

  #remember(trackUrl: string, found: FoundAudio): void {
    const expire = Number(new URL(found.url).searchParams.get('expire'))
    const expiresAt =
      expire > 0 ? expire * 1000 - EXPIRY_MARGIN_MS : this.#now() + DEFAULT_LIFETIME_MS

    this.#links.delete(trackUrl)
    this.#links.set(trackUrl, { found, expiresAt })
    if (this.#links.size > MAX_ENTRIES) {
      const oldest = this.#links.keys().next().value
      if (oldest !== undefined) this.#links.delete(oldest)
    }
  }
}
