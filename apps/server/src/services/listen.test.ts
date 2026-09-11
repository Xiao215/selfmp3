import { describe, expect, it } from 'vitest'
import { ListenService } from './listen.js'

const TRACK = 'https://music.youtube.com/watch?v=m9SMT5ipbxk'

/** yt-dlp that hands out numbered links expiring at `expire` (seconds), counting its runs. */
function fakeYtDlp(expire: number | null) {
  let runs = 0
  return {
    get runs() {
      return runs
    },
    audioUrl: () => {
      runs++
      const query = expire === null ? '' : `&expire=${expire}`
      return Promise.resolve(`https://rr1.googlevideo.test/videoplayback?n=${runs}${query}`)
    },
  }
}

describe('ListenService', () => {
  it('asks yt-dlp once for a track, however often the player seeks', async () => {
    const ytdlp = fakeYtDlp(4_000)
    const listen = new ListenService(ytdlp, () => 1_000_000)

    const first = await listen.source(TRACK)
    expect(await listen.source(TRACK)).toBe(first)
    expect(ytdlp.runs).toBe(1)
  })

  it('shares one run between requests that arrive together', async () => {
    const ytdlp = fakeYtDlp(4_000)
    const listen = new ListenService(ytdlp, () => 1_000_000)

    const [a, b] = await Promise.all([listen.source(TRACK), listen.source(TRACK)])
    expect(a).toBe(b)
    expect(ytdlp.runs).toBe(1)
  })

  it('looks the link up again before YouTube lets it expire', async () => {
    let now = 1_000_000
    const ytdlp = fakeYtDlp(4_000) // 4,000,000 ms
    const listen = new ListenService(ytdlp, () => now)

    await listen.source(TRACK)
    now = 4_000_000 - 11 * 60_000
    await listen.source(TRACK)
    expect(ytdlp.runs).toBe(1)

    now = 4_000_000 - 9 * 60_000
    await listen.source(TRACK)
    expect(ytdlp.runs).toBe(2)
  })

  it('keeps a link with no expiry for an hour', async () => {
    let now = 0
    const ytdlp = fakeYtDlp(null)
    const listen = new ListenService(ytdlp, () => now)

    await listen.source(TRACK)
    now = 59 * 60_000
    await listen.source(TRACK)
    now = 61 * 60_000
    await listen.source(TRACK)
    expect(ytdlp.runs).toBe(2)
  })

  it('looks up afresh once a link is forgotten', async () => {
    const ytdlp = fakeYtDlp(4_000)
    const listen = new ListenService(ytdlp, () => 1_000_000)

    const first = await listen.source(TRACK)
    listen.forget(TRACK)
    expect(await listen.source(TRACK)).not.toBe(first)
  })

  it('does not keep a failure', async () => {
    let fail = true
    const listen = new ListenService(
      {
        audioUrl: () =>
          fail
            ? Promise.reject(new Error('Sign in to confirm you are not a bot'))
            : Promise.resolve('https://rr1.googlevideo.test/videoplayback?expire=9999999999'),
      },
      () => 0,
    )

    await expect(listen.source(TRACK)).rejects.toThrow(/not a bot/)
    fail = false
    await expect(listen.source(TRACK)).resolves.toContain('googlevideo')
  })
})
