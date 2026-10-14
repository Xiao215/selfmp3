import { describe, expect, it } from 'vitest'
import { cookieArgs, explainCookieError, type YtCookieSettings } from './ytCookies.js'
import { YTDLP_UPDATE_HINT } from './ytdlpUpdate.js'

const none: YtCookieSettings = {
  ytCookieSource: 'none',
  ytCookieBrowser: 'chrome',
  ytCookieFile: '',
}
const chrome: YtCookieSettings = { ...none, ytCookieSource: 'browser' }
const safari: YtCookieSettings = { ...none, ytCookieSource: 'browser', ytCookieBrowser: 'safari' }
const file: YtCookieSettings = {
  ...none,
  ytCookieSource: 'file',
  ytCookieFile: '/Users/me/cookies.txt',
}

describe('cookieArgs', () => {
  it('adds nothing when cookies are off', () => {
    expect(cookieArgs(none)).toEqual([])
  })

  it('names the browser', () => {
    expect(cookieArgs(chrome)).toEqual(['--cookies-from-browser', 'chrome'])
    expect(cookieArgs(safari)).toEqual(['--cookies-from-browser', 'safari'])
  })

  it('passes the cookies file, and nothing when the path is blank', () => {
    expect(cookieArgs(file)).toEqual(['--cookies', '/Users/me/cookies.txt'])
    expect(cookieArgs({ ...file, ytCookieFile: '   ' })).toEqual([])
  })
})

describe('explainCookieError', () => {
  it('points Safari users at Full Disk Access', () => {
    const out = explainCookieError(
      "could not find safari cookies database: [Errno 1] Operation not permitted: '/Users/me/Library/Cookies/Cookies.binarycookies'",
      safari,
    )
    expect(out).toMatch(/Full Disk Access/)
  })

  it('explains a locked browser database', () => {
    expect(explainCookieError('sqlite3.OperationalError: database is locked', chrome)).toMatch(
      /Quit Chrome/,
    )
  })

  it('explains a missing browser profile', () => {
    expect(
      explainCookieError('could not find chrome cookies database in ~/Library', chrome),
    ).toMatch(/Couldn’t find Chrome/)
  })

  it('explains a missing cookies file', () => {
    expect(explainCookieError("[Errno 2] No such file or directory: '/x'", file)).toMatch(
      /wasn’t found at \/Users\/me\/cookies.txt/,
    )
  })

  /*
   * The app has no cookie settings, so a signed-out library is told what the
   * person reading it can do — not sent to look for a setting that is not
   * there.
   */
  it('tells a signed-out library what can be done without cookies', () => {
    const out = explainCookieError('The playlist does not exist. Sign in if it is private', none)
    expect(out).toMatch(/signed-in account/)
    expect(out).toMatch(/make it public or unlisted/)
    expect(out).not.toMatch(/Settings|cookies/i)
    expect(explainCookieError('This video is private', chrome)).toMatch(
      /logged in to YouTube Music/,
    )
  })

  it('leaves removed, region-locked and age-checked videos to their own words', () => {
    for (const raw of [
      '[youtube] abc: Video unavailable. This video has been removed by the uploader',
      '[youtube] abc: Video unavailable. The uploader has not made this video available in your country',
      '[youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.',
    ]) {
      expect(explainCookieError(raw, none)).toBe(raw)
      expect(explainCookieError(raw, chrome)).toBe(raw)
    }
  })

  /*
   * The bot wall is the one error that lies about itself. It says "Sign in",
   * so every sign-in rule here matches it, and the advice they give — go and
   * re-export your cookies — is both useless and risky: the cookies were never
   * wrong, and using an account under a block is how the account goes too.
   */
  it('does not blame cookies when YouTube is rate-limiting the address', () => {
    for (const settings of [none, chrome, file]) {
      const explained = explainCookieError('Sign in to confirm you’re not a bot', settings)
      expect(explained).toMatch(/rate-limiting this network/)
      expect(explained).not.toMatch(/logged in to YouTube Music/)
      expect(explained).not.toMatch(/export/i)
    }
  })

  it('mentions cookies under a rate limit only to a library that has them', () => {
    const signedOut = explainCookieError('HTTP Error 429: Too Many Requests', none)
    expect(signedOut).not.toMatch(/cookies|Settings/i)
    expect(signedOut).toMatch(/pick up once it lifts/)
    expect(explainCookieError('HTTP Error 429: Too Many Requests', chrome)).toMatch(
      /your cookies are not the problem/,
    )
  })

  it('blames a refused download on an outdated yt-dlp, with the update that fits', () => {
    const out = explainCookieError('unable to download video data: HTTP Error 403: Forbidden', none)
    expect(out).toMatch(/out of date/)
    expect(out).toContain(`(${YTDLP_UPDATE_HINT})`)
  })

  it('leaves unrelated errors alone', () => {
    expect(explainCookieError('Unable to extract player version', chrome)).toBe(
      'Unable to extract player version',
    )
  })
})
