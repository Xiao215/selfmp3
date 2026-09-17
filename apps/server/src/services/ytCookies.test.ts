import { describe, expect, it } from 'vitest'
import { cookieArgs, explainCookieError, type YtCookieSettings } from './ytCookies.js'

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

  it('tells a signed-out user to set up cookies', () => {
    expect(
      explainCookieError('The playlist does not exist. Sign in if it is private', none),
    ).toMatch(/Settings → Importing/)
    expect(explainCookieError('This video is private', chrome)).toMatch(
      /logged in to YouTube Music/,
    )
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

  it('offers cookies as a way to raise the limit, but only when there are none', () => {
    expect(explainCookieError('HTTP Error 429: Too Many Requests', none)).toMatch(
      /raises the limit/,
    )
    expect(explainCookieError('HTTP Error 429: Too Many Requests', chrome)).not.toMatch(
      /raises the limit/,
    )
  })

  it('blames a refused download on an outdated yt-dlp', () => {
    expect(
      explainCookieError('unable to download video data: HTTP Error 403: Forbidden', none),
    ).toMatch(/brew upgrade yt-dlp/)
  })

  it('leaves unrelated errors alone', () => {
    expect(explainCookieError('Unable to extract player version', chrome)).toBe(
      'Unable to extract player version',
    )
  })
})
