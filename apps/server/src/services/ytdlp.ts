import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import type { ToolStatus } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import { cookieArgs, explainCookieError, type YtCookieSettings } from './ytCookies.js'

/**
 * A typed wrapper around the `yt-dlp` command line.
 *
 * Everything about running an external binary that can go wrong is handled
 * here in one place: it is never invoked through a shell (so a URL can never
 * be interpreted as a command), every call has a timeout, output is capped so
 * a runaway process cannot exhaust memory, and the child is killed if the
 * caller aborts.
 */

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

/** Cap captured output; yt-dlp can be extremely chatty on failure. */
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface RunOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /**
   * Called for each line the command prints, from either stream. yt-dlp's
   * `[download] 42.1%` progress goes to stdout, and only warnings and errors
   * to stderr.
   */
  readonly onLine?: (line: string) => void
}

export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 10 * 60 * 1000, signal, onLine } = options

  return new Promise<RunResult>(resolve => {
    // `shell: false` is the default and is load-bearing: it is what makes it
    // safe to pass a user-supplied URL as an argument.
    const child = spawn(command, [...args], { shell: false, windowsHide: true })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (result: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    const stdoutLines = lineSplitter(onLine)
    const stderrLines = lineSplitter(onLine)

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += text
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

const NO_COOKIES: YtCookieSettings = { ytCookieSource: 'none', ytCookieBrowser: 'chrome', ytCookieFile: '' }

export class YtDlpService {
  readonly #logger: Logger
  readonly #cookies: () => YtCookieSettings
  #cachedStatus: ToolStatus | null = null

  /**
   * `cookies` is read on every call rather than once, so changing the cookie
   * settings takes effect on the next probe without a restart.
   */
  constructor(logger: Logger, cookies: () => YtCookieSettings = () => NO_COOKIES) {
    this.#logger = logger.child('yt-dlp')
    this.#cookies = cookies
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
      ytdlpVersion: ytdlp.code === 0 ? ytdlp.stdout.trim().split(/\s+/)[0] ?? null : null,
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
  ): Promise<{ kind: 'single' | 'playlist'; playlistTitle: string | null; tracks: ProbedTrack[] }> {
    const result = await run(
      'yt-dlp',
      [
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
      throw new Error(this.#explain(summarizeError(result.stderr, 'could not read that link')))
    }

    let parsed: YtDlpJson
    try {
      parsed = JSON.parse(result.stdout) as YtDlpJson
    } catch {
      throw new Error('yt-dlp returned something unreadable')
    }

    if (parsed._type === 'playlist' && Array.isArray(parsed.entries)) {
      const tracks = parsed.entries
        .filter((entry): entry is YtDlpJson => entry != null)
        .map(entry => this.#toTrack(entry, url))
        .filter(track => track.url.length > 0)
      return {
        kind: 'playlist',
        playlistTitle: parsed.playlist_title ?? parsed.title ?? null,
        tracks,
      }
    }

    return { kind: 'single', playlistTitle: null, tracks: [this.#toTrack(parsed, url)] }
  }

  #toTrack(json: YtDlpJson, fallbackUrl: string): ProbedTrack {
    // Flat playlist entries carry only an id, so rebuild a watch URL from it.
    const url =
      json.webpage_url ??
      (json.url && /^https?:/.test(json.url)
        ? json.url
        : json.id
          ? `https://www.youtube.com/watch?v=${json.id}`
          : fallbackUrl)

    // `track` is the real song title when YouTube has music metadata;
    // `title` is the video title, which often carries junk.
    const title = json.track ?? json.title ?? ''
    const rawArtist = json.artist ?? json.creator ?? json.uploader ?? json.channel ?? ''

    return {
      url,
      title: title.trim(),
      artist: rawArtist.replace(/\s*-\s*Topic$/i, '').trim(),
      album: (json.album ?? '').trim(),
      duration: typeof json.duration === 'number' ? json.duration : 0,
      thumbnail: json.thumbnail ?? null,
    }
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
    const args = [
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
      throw new Error(this.#explain(summarizeError(result.stderr + result.stdout, 'download failed')))
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
