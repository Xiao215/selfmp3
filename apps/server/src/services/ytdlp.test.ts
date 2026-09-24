import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '../logger.js'
import {
  isVideoEntry,
  parseProgress,
  run,
  toProbedTrack,
  YtDlpService,
  ytdlpAgeDays,
} from './ytdlp.js'
import {
  freshState,
  PAUSE_MS,
  RateLimitedError,
  YtThrottleService,
  type ThrottleState,
} from './ytThrottle.js'

describe('toProbedTrack', () => {
  const WATCH = 'https://www.youtube.com/watch?v=ZRtdQ81jPUQ'

  it('keeps the song’s own title and artist when YouTube has them', () => {
    const track = toProbedTrack(
      {
        track: 'アイドル',
        artist: 'YOASOBI',
        title: 'YOASOBI「アイドル」Official Music Video',
        uploader: 'Ayase / YOASOBI',
      },
      WATCH,
    )
    expect(track).toMatchObject({ title: 'アイドル', artist: 'YOASOBI', url: WATCH })
  })

  it('tidies a video’s title into the song’s, with the artist it names', () => {
    const track = toProbedTrack(
      {
        title: 'YOASOBI「アイドル」Official Music Video',
        uploader: 'Ayase / YOASOBI',
        id: 'ZRtdQ81jPUQ',
      },
      WATCH,
    )
    expect(track).toMatchObject({ title: 'アイドル', artist: 'YOASOBI', url: WATCH })
  })

  it('keeps the channel as the artist when the title names none', () => {
    const track = toProbedTrack(
      { title: 'Shinunoga E-Wa (Official Video)', channel: 'Fujii Kaze - Topic' },
      WATCH,
    )
    expect(track).toMatchObject({ title: 'Shinunoga E-Wa', artist: 'Fujii Kaze' })
  })

  it("takes a flat entry's largest thumbnail as its cover, since it names no thumbnail", () => {
    const track = toProbedTrack(
      {
        id: 'n9GWKPu9Fh8',
        title: 'Bubble',
        thumbnails: [
          { url: 'https://i.ytimg.test/small.jpg', width: 168 },
          { url: 'https://i.ytimg.test/large.jpg', width: 336 },
          { url: 'https://i.ytimg.test/medium.jpg', width: 246 },
        ],
      },
      WATCH,
    )
    expect(track.thumbnail).toBe('https://i.ytimg.test/large.jpg')
    expect(toProbedTrack({ id: 'x', title: 'Bare' }, WATCH).thumbnail).toBeNull()
  })
})

/**
 * A stand-in for yt-dlp, run as a real child process: progress on stdout, the
 * way yt-dlp prints it, with a line split across two writes and the last one
 * left without a newline.
 */
const FAKE_DOWNLOAD = `
process.stdout.write('[download] Destination: song.m4a\\n')
process.stdout.write('[download]  12.5% of 3.29MiB at 1.00MiB/s ETA 00:03\\n[download]  6')
process.stdout.write('0.0% of 3.29MiB at 1.00MiB/s ETA 00:01\\n')
process.stderr.write('WARNING: something to mention\\n')
process.stdout.write('[download] 100% of 3.29MiB in 00:00:02')
`

describe('run', () => {
  it('hands over whole lines from stdout as well as stderr', async () => {
    const lines: string[] = []
    const result = await run(process.execPath, ['-e', FAKE_DOWNLOAD], {
      onLine: line => lines.push(line),
    })

    expect(result.code).toBe(0)
    expect(lines).toContain('WARNING: something to mention')
    expect(lines.map(parseProgress).filter(percent => percent !== null)).toEqual([12.5, 60, 100])
  })
})

describe('isVideoEntry', () => {
  it('keeps the songs of a search page and drops its albums, playlists and channels', () => {
    // What `--flat-playlist` lists for music.youtube.com/search?q=yoasobi.
    const song = { ie_key: 'Youtube', url: 'https://music.youtube.com/watch?v=k0g04t7ZeSw' }
    const album = {
      ie_key: 'YoutubeTab',
      url: 'https://music.youtube.com/browse/MPREb_hqiB0KumHYT',
    }
    const playlist = {
      ie_key: 'YoutubeTab',
      url: 'https://music.youtube.com/browse/VLPLcKNQQ5neMz2J5RP49n',
    }
    const artist = {
      ie_key: 'YoutubeTab',
      url: 'https://music.youtube.com/browse/UCISF03gz20_8vWnkSVYlOEw',
    }
    expect([song, album, playlist, artist].map(isVideoEntry)).toEqual([true, false, false, false])
  })

  it('judges by the address when the entry names no extractor', () => {
    expect(isVideoEntry({ url: 'https://www.youtube.com/watch?v=dGZqpVCJP3k' })).toBe(true)
    expect(isVideoEntry({})).toBe(true)
    expect(isVideoEntry({ url: 'https://www.youtube.com/playlist?list=PL123' })).toBe(false)
    expect(isVideoEntry({ url: 'https://www.youtube.com/channel/UC123' })).toBe(false)
    expect(isVideoEntry({ url: 'https://www.youtube.com/@yoasobi' })).toBe(false)
  })
})

describe('parseProgress', () => {
  it('reads the percentage and ignores every other line', () => {
    expect(parseProgress('[download]  42.1% of 4.03MiB at 2.00MiB/s ETA 00:01')).toBe(42.1)
    expect(parseProgress('[download] 100% of 3.29MiB in 00:00:00 at 8.00MiB/s')).toBe(100)
    expect(parseProgress('[download] Destination: song.m4a')).toBeNull()
    expect(parseProgress('[ExtractAudio] Destination: song.m4a')).toBeNull()
  })
})

describe('ytdlpAgeDays', () => {
  const NOW = new Date('2026-09-17T00:00:00Z')

  it('reads the release date out of a stable version', () => {
    expect(ytdlpAgeDays('2026.08.19', NOW)).toBe(29)
    expect(ytdlpAgeDays('2026.09.17', NOW)).toBe(0)
  })

  it('reads a nightly, which puts a time after the date', () => {
    expect(ytdlpAgeDays('2026.09.10.232734', NOW)).toBe(7)
  })

  it('says nothing rather than something wrong for a build from source', () => {
    expect(ytdlpAgeDays('2026.08.19.dev0+g1a2b3c4', NOW)).toBe(29)
    expect(ytdlpAgeDays('unknown', NOW)).toBeNull()
    expect(ytdlpAgeDays(null, NOW)).toBeNull()
    expect(ytdlpAgeDays('', NOW)).toBeNull()
  })
})

/**
 * A search is a request to YouTube like any other, and this checks it is
 * treated as one: the arguments every call carries, the cookies, the budget,
 * and the bot wall. The stand-in for `yt-dlp` is a script on PATH rather than
 * a replaced function, for the reason importQueue.test.ts gives — the first
 * version of the migration searcher called yt-dlp on its own, with none of
 * those, and nothing between the service and the binary should be able to
 * hide that happening again.
 */
describe('YtDlpService.search', () => {
  let dir: string
  let savedPath: string | undefined
  let state: ThrottleState
  let throttle: YtThrottleService
  let cookiesFile: string
  let service: YtDlpService

  const NOW = 1_700_000_000_000

  /** What the stand-in was asked, one argument a line. */
  const askedArgs = (): string[] =>
    fs.readFileSync(path.join(dir, 'args.txt'), 'utf8').split('\n').filter(Boolean)

  /** Make the stand-in fail with yt-dlp's words on stderr. */
  const ytDlpFailsWith = (message: string): void => {
    fs.writeFileSync(path.join(dir, 'stderr.txt'), `ERROR: [youtube:search] ${message}\n`)
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-search-'))
    const bin = path.join(dir, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, 'yt-dlp'),
      `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args.txt"
if [ -f "${dir}/stderr.txt" ]; then cat "${dir}/stderr.txt" >&2; exit 1; fi
cat "${dir}/stdout.json"
`,
      { mode: 0o755 },
    )
    savedPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`

    // The cookie file has to exist: the service checks for it before yt-dlp
    // would silently run signed out without one.
    cookiesFile = path.join(dir, 'cookies.txt')
    fs.writeFileSync(cookiesFile, '# Netscape HTTP Cookie File\n')

    // A bucket with a few requests in it, and no clock ticking, so what is
    // spent can be counted.
    state = { ...freshState(NOW), tokens: 3 }
    throttle = new YtThrottleService(
      { get: () => state, save: next => void (state = next) },
      () => true,
      () => NOW,
    )
    service = new YtDlpService(
      createLogger('silent'),
      () => ({ ytCookieSource: 'file', ytCookieBrowser: 'chrome', ytCookieFile: cookiesFile }),
      throttle,
    )
  })

  afterEach(() => {
    process.env.PATH = savedPath
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('asks the way every other call does, and spends the budget', async () => {
    fs.writeFileSync(
      path.join(dir, 'stdout.json'),
      JSON.stringify({
        _type: 'playlist',
        entries: [
          {
            id: 'YQHsXMglC9A',
            title: 'Adele - Hello',
            channel: 'Adele',
            duration: 367,
            thumbnails: [
              { url: 'https://i.ytimg.com/vi/YQHsXMglC9A/default.jpg', width: 120 },
              { url: 'https://i.ytimg.com/vi/YQHsXMglC9A/hqdefault.jpg', width: 480 },
            ],
          },
          {
            id: 'DfG6VKnjrVw',
            url: 'https://www.youtube.com/watch?v=DfG6VKnjrVw',
            title: 'Hello (Live at the NRJ Awards)',
            uploader: 'Someone',
            duration: null,
          },
          null,
        ],
      }),
    )

    const hits = await service.search('Adele Hello', 5)

    const args = askedArgs()
    // Pinned to IPv4 and handed a JS runtime, like a probe or a download.
    expect(args.slice(0, 3)).toEqual(['-4', '--js-runtimes', `node:${process.execPath}`])
    expect(args).toContain('--flat-playlist')
    // Signed in, when the settings say so.
    expect(args).toContain('--cookies')
    expect(args[args.indexOf('--cookies') + 1]).toBe(cookiesFile)
    // The query goes after `--`, so a search that starts with a dash is still a search.
    expect(args.slice(-2)).toEqual(['--', 'ytsearch5:Adele Hello'])

    expect(hits).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=YQHsXMglC9A',
        title: 'Adele - Hello',
        channel: 'Adele',
        duration: 367,
        thumbnail: 'https://i.ytimg.com/vi/YQHsXMglC9A/default.jpg',
      },
      {
        url: 'https://www.youtube.com/watch?v=DfG6VKnjrVw',
        title: 'Hello (Live at the NRJ Awards)',
        channel: 'Someone',
        duration: 0,
        thumbnail: 'https://i.ytimg.com/vi/DfG6VKnjrVw/default.jpg',
      },
    ])

    // One request's worth gone: the search came out of the same bucket.
    expect(state.tokens).toBe(2)
  })

  it('treats a bot wall as the rate limit it is, and pauses everything', async () => {
    ytDlpFailsWith('Sign in to confirm you’re not a bot. Use --cookies-from-browser')

    await expect(service.search('Adele Hello', 5)).rejects.toBeInstanceOf(RateLimitedError)

    // The budget is cut and the queue paused, exactly as after a blocked download.
    expect(throttle.status().pausedUntil).not.toBeNull()
    expect(throttle.status().ratchet).toBe(0.5)
  })

  it('does not blame the network for a search that just failed', async () => {
    ytDlpFailsWith('Unable to extract search results')

    await expect(service.search('Adele Hello', 5)).rejects.not.toBeInstanceOf(RateLimitedError)
    expect(throttle.status().pausedUntil).toBeNull()
    expect(throttle.status().ratchet).toBe(1)
  })

  it('says so when there is no budget left, rather than asking anyway', async () => {
    state = { ...state, tokens: 0 }
    const controller = new AbortController()
    const pending = service.search('Adele Hello', 5, controller.signal)
    // Patient: it waits for a token rather than failing at once, so the only
    // way out with a stopped clock is the job being cancelled.
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(fs.existsSync(path.join(dir, 'args.txt'))).toBe(false)
  })
})

/**
 * What the download queue's calls do when a rate-limit pause is already on.
 *
 * The queue declines to claim a job while the throttle is paused, so nothing
 * should be sitting in `#pace` waiting one out. One job can be there anyway:
 * the one claimed in the moment before another worker's refusal landed. It
 * used to sleep here for the whole quarter of an hour, holding a worker slot
 * and reading as `running` the entire time — which is precisely what the
 * scheduler is written to avoid, and what made the queue's rate-limit tests
 * fail on a loaded machine, where the second child is slow enough to lose the
 * race. It comes back as a refusal instead, and the queue puts it back.
 */
describe('a queue job that reaches yt-dlp just after a pause began', () => {
  let dir: string
  let savedPath: string | undefined
  let state: ThrottleState
  let service: YtDlpService

  const NOW = 1_700_000_000_000

  /** True once the stand-in binary has been run at all. */
  const asked = (): boolean => fs.existsSync(path.join(dir, 'args.txt'))

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-paused-'))
    const bin = path.join(dir, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(
      path.join(bin, 'yt-dlp'),
      `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args.txt"
`,
      { mode: 0o755 },
    )
    savedPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ''}`

    // Tokens to spare, so the pause is the only thing in the way — and a
    // stopped clock, so anything that decides to wait it out waits forever.
    state = { ...freshState(NOW), tokens: 5, pausedUntil: NOW + PAUSE_MS, limitedAt: NOW }
    service = new YtDlpService(
      createLogger('silent'),
      () => ({ ytCookieSource: 'none', ytCookieBrowser: 'chrome', ytCookieFile: '' }),
      new YtThrottleService(
        { get: () => state, save: next => void (state = next) },
        () => false,
        () => NOW,
      ),
    )
  })

  afterEach(() => {
    process.env.PATH = savedPath
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('goes back in the queue rather than holding its slot for the pause', async () => {
    await expect(
      service.download({
        url: 'https://www.youtube.com/watch?v=6I1SNW0tVYk',
        outputTemplate: path.join(dir, '%(title)s.%(ext)s'),
        hasFfmpeg: false,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError)
    // Nothing was asked of YouTube, so nothing was spent for asking.
    expect(asked()).toBe(false)
    expect(state.tokens).toBe(5)
  })

  it('answers the same way to the probe that comes before the download', async () => {
    await expect(
      service.probe('https://www.youtube.com/watch?v=6I1SNW0tVYk', undefined, 'patient'),
    ).rejects.toBeInstanceOf(RateLimitedError)
    expect(asked()).toBe(false)
  })

  it('is still patient about an empty bucket, which is a wait of seconds', async () => {
    // No pause, just nothing in the bucket: this is the wait the queue exists
    // to sit through, and giving up on it would fail jobs for being paced.
    state = { ...state, tokens: 0, pausedUntil: 0, limitedAt: 0 }
    const controller = new AbortController()
    const pending = service.download({
      url: 'https://www.youtube.com/watch?v=6I1SNW0tVYk',
      outputTemplate: path.join(dir, '%(title)s.%(ext)s'),
      hasFfmpeg: false,
      signal: controller.signal,
    })
    // With a stopped clock the only way out is the job being cancelled, which
    // is what "still waiting" looks like from here.
    controller.abort()
    await expect(pending).rejects.not.toBeInstanceOf(RateLimitedError)
    expect(asked()).toBe(false)
  })
})
