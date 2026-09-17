import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { cleanArtist, tidyVideoTitle, type ToolStatus } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { cookieArgs, explainCookieError, type YtCookieSettings } from './ytCookies.js'
import { isRateLimited, RateLimitedError, type YtThrottleService } from './ytThrottle.js'

/**
 * A typed wrapper around the `yt-dlp` command line.
 *
 * Everything about running an external binary that can go wrong is handled
 * here in one place: it is never invoked through a shell (so a URL can never
 * be interpreted as a command), every call has a timeout, output is capped so
 * a runaway process cannot exhaust memory, and the child is killed if the
 * caller aborts.
 */

interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  /** True when output ran past the cap, so `stdout` is a prefix of what was said. */
  readonly truncated: boolean
}

/**
 * Caps on captured output, different for the two streams because they are put
 * to different uses. stderr is read by a human, and yt-dlp is extremely chatty
 * on failure, so a couple of megabytes is already more than anyone wants.
 * stdout is JSON that has to parse as a whole — a playlist cut off in the
 * middle is not a shorter playlist, it is a syntax error — and at roughly a
 * kilobyte a track, two megabytes gave up at about sixteen hundred of them.
 */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_STDOUT_BYTES = 64 * 1024 * 1024

interface RunOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /**
   * Called for each line the command prints, from either stream. yt-dlp's
   * `[download] 42.1%` progress goes to stdout, and only warnings and errors
   * to stderr.
   */
  readonly onLine?: (line: string) => void
}

export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const { timeoutMs = 10 * 60 * 1000, signal, onLine } = options

  return new Promise<RunResult>(resolve => {
    // `shell: false` is the default and is load-bearing: it is what makes it
    // safe to pass a user-supplied URL as an argument.
    const child = spawn(command, [...args], { shell: false, windowsHide: true })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let truncated = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // A signal already aborted never fires its listener, and a cancel landing
    // between two yt-dlp calls lands exactly there — so the download this just
    // started would run to its timeout and the cancelled job finish as done.
    if (signal?.aborted === true) onAbort()

    const finish = (result: Omit<RunResult, 'truncated'>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ ...result, truncated })
    }

    const stdoutLines = lineSplitter(onLine)
    const stderrLines = lineSplitter(onLine)

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stdout.length < MAX_STDOUT_BYTES) stdout += text
      else truncated = true
      stdoutLines.push(text)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += text
      stderrLines.push(text)
    })

    child.on('error', error => {
      finish({ code: -1, stdout, stderr: stderr || error.message, timedOut })
    })

    child.on('close', code => {
      stdoutLines.flush()
      stderrLines.flush()
      finish({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

/** Whole lines out of a stream's chunks, however the chunks happen to split them. */
function lineSplitter(onLine: ((line: string) => void) | undefined): {
  push: (text: string) => void
  flush: () => void
} {
  let buffer = ''
  return {
    push: text => {
      if (!onLine) return
      buffer += text
      const lines = buffer.split(/\r?\n|\r/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    },
    flush: () => {
      if (onLine && buffer.trim()) onLine(buffer)
      buffer = ''
    },
  }
}

/** The last few lines of stderr — where yt-dlp puts the actual reason. */
export function summarizeError(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('[download]'))

  const errorLine = lines.reverse().find(line => /^ERROR:/i.test(line))
  const message = errorLine ?? lines[0] ?? fallback
  return message.replace(/^ERROR:\s*/i, '').slice(0, 400) || fallback
}

/** `[download]  42.1% of 4.03MiB at ...` -> 42.1 */
export function parseProgress(line: string): number | null {
  const match = /\[download\]\s+(\d{1,3}(?:\.\d+)?)%/.exec(line)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
}

/**
 * Arguments every call to yt-dlp carries.
 *
 * `-4` is the load-bearing one. On a dual-stack connection yt-dlp prefers
 * IPv6, and Google rate-limits IPv6 by the whole prefix an ISP delegates
 * rather than by address — because a /64 hands out more addresses than the
 * entire IPv4 internet, so blocking one means nothing. One neighbour's abuse
 * is enough to put every address a home router can offer behind the
 * "Sign in to confirm you're not a bot" wall, while the same machine's IPv4
 * answers normally. That failure reads as a login problem and is not one, so
 * this pins every request to the address family that still has a reputation
 * worth anything.
 *
 * `--js-runtimes` hands yt-dlp the node this server is already running on.
 * YouTube's player has to be run to be read, and yt-dlp enables only deno for
 * that by default: on a machine without deno — the Docker image, which is
 * built on node and has it sitting right there — it reports no runtime at all,
 * warns that extraction without one is deprecated, and carries on in a mode
 * that is on its way out. The option adds to the list rather than replacing
 * it, so a Mac whose Homebrew yt-dlp brought deno keeps using that. The path is
 * spelled out because `node` need not be on the PATH of whatever started the
 * server, and this process is proof of where one is.
 */
const BASE_ARGS = ['-4', '--js-runtimes', `node:${process.execPath}`] as const

/**
 * How long a request someone is waiting on will sit for the budget before it
 * gives up and says so. Long enough to ride out ordinary pacing, short enough
 * that a fifteen minute pause is reported rather than endured.
 */
const INTERACTIVE_WAIT_MS = 30_000

/**
 * How old the installed yt-dlp is, in days.
 *
 * Its version *is* its release date — `2026.08.19`, and nightlies add a time
 * on the end — so nothing has to be fetched to know how far behind it has
 * fallen. Worth surfacing because an out-of-date yt-dlp is the most common
 * cause of downloads failing, and it fails in ways that look like anything but
 * that: a bot check, a 403, formats that are suddenly missing.
 *
 * `null` for a version string that is not a date, which is what a build from
 * source looks like; unknown is not the same as fine, so the caller decides.
 */
export function ytdlpAgeDays(version: string | null, now = new Date()): number | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version?.trim() ?? '')
  if (!match) return null
  const [, year, month, day] = match
  const released = Date.UTC(Number(year), Number(month) - 1, Number(day))
  if (!Number.isFinite(released)) return null
  return Math.floor((now.getTime() - released) / 86_400_000)
}

/** Past this many days, yt-dlp is old enough to be the reason things fail. */
export const YTDLP_STALE_DAYS = 30

/** Metadata yt-dlp reports for one track. */
export interface ProbedTrack {
  url: string
  title: string
  artist: string
  album: string
  duration: number
  thumbnail: string | null
}

/** The subset of yt-dlp's JSON dump this app reads. */
interface YtDlpJson {
  _type?: string
  /** Which extractor a flat entry belongs to: `Youtube` for a video, `YoutubeTab` for a page. */
  ie_key?: string
  id?: string
  url?: string
  webpage_url?: string
  title?: string
  track?: string
  artist?: string
  creator?: string
  uploader?: string
  channel?: string
  album?: string
  duration?: number
  thumbnail?: string
  entries?: YtDlpJson[]
  playlist_title?: string
}

/** One entry of yt-dlp's JSON as a track to review and import. */
export function toProbedTrack(json: YtDlpJson, fallbackUrl: string): ProbedTrack {
  // Flat playlist entries carry only an id, so rebuild a watch URL from it.
  const url =
    json.webpage_url ??
    (json.url && /^https?:/.test(json.url)
      ? json.url
      : json.id
        ? `https://www.youtube.com/watch?v=${json.id}`
        : fallbackUrl)

  // `track` and `artist` are the song's own when YouTube has music metadata.
  // Without them `title` is the video's — "YOASOBI「アイドル」Official Music
  // Video" — so it is tidied into the song's name, and the artist it writes in
  // front is preferred to the channel's name (titles.ts).
  const credited = json.artist ?? json.creator
  const channel = cleanArtist(credited ?? json.uploader ?? json.channel ?? '')
  const tidied = json.track ? null : tidyVideoTitle(json.title ?? '', channel)

  return {
    url,
    title: (json.track ?? tidied?.title ?? '').trim(),
    artist: credited ? channel : (tidied?.artist ?? channel),
    album: (json.album ?? '').trim(),
    duration: typeof json.duration === 'number' ? json.duration : 0,
    thumbnail: json.thumbnail ?? null,
  }
}

/**
 * Whether one entry of a flat listing is a video.
 *
 * A search page, or an artist's, lists albums, playlists and channels beside
 * the songs: `YoutubeTab` entries at a `/browse/`, `/playlist` or channel
 * address, with no title of their own. Read as a track, one of those was
 * downloaded as a whole album into a single file — yt-dlp resumed the file for
 * each song and YouTube answered 416 — so only videos count.
 */
export function isVideoEntry(entry: { ie_key?: string; url?: string }): boolean {
  if (entry.ie_key !== undefined && entry.ie_key !== 'Youtube') return false
  return !/\/(browse\/|playlist\?|channel\/|c\/|user\/|@)/.test(entry.url ?? '')
}

export class YtDlpService {
  readonly #logger: Logger
  readonly #cookies: () => YtCookieSettings
  readonly #throttle: YtThrottleService
  #cachedStatus: ToolStatus | null = null

  /**
   * `cookies` is read on every call rather than once, so changing the cookie
   * settings takes effect on the next probe without a restart.
   *
   * `throttle` is spent by every call that reaches YouTube — a probe, a
   * preview and a download are the same request from the same address as far
   * as YouTube is concerned, so they come out of one budget.
   */
  constructor(logger: Logger, cookies: () => YtCookieSettings, throttle: YtThrottleService) {
    this.#logger = logger.child('yt-dlp')
    this.#cookies = cookies
    this.#throttle = throttle
  }

  /**
   * Wait for the budget to allow one request.
   *
   * `maxWaitMs` is passed by the paths someone is waiting on in a browser;
   * the download queue passes none and waits as long as it takes.
   */
  async #pace(options: { signal?: AbortSignal; maxWaitMs?: number }): Promise<void> {
    const took = await this.#throttle.take(options)
    if (took) return
    const seconds = Math.ceil(this.#throttle.waitMs() / 1000)
    throw new Error(
      `Pacing requests to YouTube so this address does not get blocked — ` +
        `try again in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`,
    )
  }

  /**
   * The cookie arguments for the current settings.
   *
   * A missing cookies.txt is checked here because yt-dlp itself does not
   * complain about one — it silently runs signed-out, which is exactly the
   * confusing failure this setting exists to prevent.
   */
  async #cookieArgs(): Promise<string[]> {
    const settings = this.#cookies()
    if (settings.ytCookieSource === 'file' && settings.ytCookieFile.trim()) {
      const file = settings.ytCookieFile.trim()
      const readable = await fsp.access(file, fsConstants.R_OK).then(
        () => true,
        () => false,
      )
      if (!readable) {
        throw new Error(this.#explain(`[Errno 2] No such file or directory: '${file}'`))
      }
    }
    return cookieArgs(settings)
  }

  #explain(message: string): string {
    return explainCookieError(message, this.#cookies())
  }

  /**
   * The error for a run that failed, and the consequence if it was a rate
   * limit.
   *
   * yt-dlp's own words decide which it is, before they are rewritten for a
   * person — the rewritten text no longer says "bot" or "429", and looking for
   * those after the fact is how a rate limit came to be treated as a broken
   * song. The budget is cut here rather than by whoever called, so a block met
   * while previewing a track or pasting a link counts the same as one met by
   * the download queue: YouTube does not care which of them asked.
   */
  #failure(raw: string): Error {
    if (!isRateLimited(raw)) return new Error(this.#explain(raw))
    this.#throttle.penalize()
    this.#logger.warn('YouTube is rate-limiting this address; pausing requests', { raw })
    return new RateLimitedError(this.#explain(raw))
  }

  /** Whether yt-dlp and ffmpeg are installed. Cached after the first success. */
  async status(force = false): Promise<ToolStatus> {
    if (this.#cachedStatus && !force) return this.#cachedStatus

    const [ytdlp, ffmpeg] = await Promise.all([
      run('yt-dlp', ['--version'], { timeoutMs: 10_000 }),
      run('ffmpeg', ['-version'], { timeoutMs: 10_000 }),
    ])

    const status: ToolStatus = {
      ytdlp: ytdlp.code === 0,
      ffmpeg: ffmpeg.code === 0,
      ytdlpVersion: ytdlp.code === 0 ? (ytdlp.stdout.trim().split(/\s+/)[0] ?? null) : null,
    }

    // Only cache a working state: if the tool is missing, the user may be
    // installing it right now and should not have to restart the server.
    if (status.ytdlp) this.#cachedStatus = status
    return status
  }

  /**
   * Read metadata without downloading. Handles single videos and playlists.
   *
   * `--flat-playlist` keeps a 200-track playlist from taking two minutes to
   * resolve; the per-track detail is filled in at download time anyway.
   */
  async probe(
    url: string,
    signal?: AbortSignal,
    /**
     * `patient` is for the download queue, which would rather wait for the
     * budget than fail. Signed out, a request's worth takes 48 seconds to come
     * back, so the wait a person will sit through would fail the queue's own
     * jobs for nothing more than having been paced.
     */
    wait: 'interactive' | 'patient' = 'interactive',
  ): Promise<{ kind: 'single' | 'playlist'; playlistTitle: string | null; tracks: ProbedTrack[] }> {
    await this.#pace({
      ...(signal ? { signal } : {}),
      ...(wait === 'interactive' ? { maxWaitMs: INTERACTIVE_WAIT_MS } : {}),
    })
    const result = await run(
      'yt-dlp',
      [
        ...BASE_ARGS,
        '--dump-single-json',
        '--flat-playlist',
        '--no-warnings',
        ...(await this.#cookieArgs()),
        '--',
        url,
      ],
      { timeoutMs: 90_000, ...(signal ? { signal } : {}) },
    )

    if (result.code !== 0) {
      throw this.#failure(summarizeError(result.stderr, 'could not read that link'))
    }

    let parsed: YtDlpJson
    try {
      parsed = JSON.parse(result.stdout) as YtDlpJson
    } catch {
      // Say which of the two it was. A very long playlist runs past the cap on
      // captured output, and "unreadable" sends you looking for the wrong thing.
      throw new Error(
        result.truncated
          ? 'that playlist is too long to read in one go — try importing it in parts'
          : 'yt-dlp returned something unreadable',
      )
    }

    if (parsed._type === 'playlist' && Array.isArray(parsed.entries)) {
      const tracks = parsed.entries
        .filter((entry): entry is YtDlpJson => entry != null && isVideoEntry(entry))
        .map(entry => toProbedTrack(entry, url))
        .filter(track => track.url.length > 0)
      return {
        kind: 'playlist',
        playlistTitle: parsed.playlist_title ?? parsed.title ?? null,
        tracks,
      }
    }

    return { kind: 'single', playlistTitle: null, tracks: [toProbedTrack(parsed, url)] }
  }

  /**
   * A direct link to a track's audio, for listening before importing it.
   *
   * m4a first, as for downloads, and here for a second reason: Safari cannot
   * play webm. YouTube only honours the link from the machine that asked for
   * it, and for a few hours.
   */
  async audioUrl(url: string, signal?: AbortSignal): Promise<string> {
    await this.#pace({ ...(signal ? { signal } : {}), maxWaitMs: INTERACTIVE_WAIT_MS })
    const result = await run(
      'yt-dlp',
      [
        ...BASE_ARGS,
        '--format',
        'bestaudio[ext=m4a]/bestaudio',
        '--get-url',
        '--no-playlist',
        '--no-warnings',
        ...(await this.#cookieArgs()),
        '--',
        url,
      ],
      { timeoutMs: 60_000, ...(signal ? { signal } : {}) },
    )
    if (result.code !== 0) {
      throw this.#failure(summarizeError(result.stderr, 'could not read that link'))
    }
    const direct = result.stdout
      .split('\n')
      .map(line => line.trim())
      .find(line => /^https?:\/\//.test(line))
    if (!direct) throw new Error('yt-dlp found no audio for that link')
    return direct
  }

  /**
   * Download the best available audio to `outputTemplate`.
   *
   * Format preference is m4a first: it is what YouTube Music serves natively,
   * so it can be saved without re-encoding, which is both faster and lossless
   * relative to the source.
   */
  async download(input: {
    url: string
    outputTemplate: string
    hasFfmpeg: boolean
    signal?: AbortSignal
    onProgress?: (percent: number) => void
  }): Promise<void> {
    await this.#pace(input.signal ? { signal: input.signal } : {})
    const args = [
      ...BASE_ARGS,
      '--format',
      'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--no-part',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
      '--output',
      input.outputTemplate,
    ]

    // Embedding tags and thumbnails needs ffmpeg; skip cleanly without it.
    if (input.hasFfmpeg) {
      args.push('--embed-metadata', '--embed-thumbnail')
    }

    args.push(...(await this.#cookieArgs()), '--', input.url)

    const result = await run('yt-dlp', args, {
      timeoutMs: 20 * 60 * 1000,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onProgress
        ? {
            onLine: (line: string) => {
              const percent = parseProgress(line)
              if (percent !== null) input.onProgress?.(percent)
            },
          }
        : {}),
    })

    if (result.timedOut) throw new Error('download timed out')
    if (result.code !== 0) {
      throw this.#failure(summarizeError(result.stderr + result.stdout, 'download failed'))
    }

    this.#logger.debug('download finished', { url: input.url })
  }

  /** Exact duration of a local file, for matching lyrics to the right version. */
  async probeDuration(absolutePath: string): Promise<number> {
    const result = await run(
      'ffprobe',
      ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', absolutePath],
      { timeoutMs: 30_000 },
    )
    if (result.code !== 0) return 0
    const value = Number.parseFloat(result.stdout.trim())
    return Number.isFinite(value) ? value : 0
  }
}
