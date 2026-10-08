import { DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN, EXTENSION_SIGNIN_ORIGIN } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { allowedOrigins } from './cors.js'

/**
 * What APP_ORIGINS is read as.
 *
 * The setting is typed by hand into a Worker's configuration, so it has to be
 * unforgiving about what it accepts: an entry that is not a web address must
 * end up on nobody's list rather than on everybody's.
 */

const silent = { warn: () => undefined, info: () => undefined, error: () => undefined }

const OWN = [DESKTOP_APP_ORIGIN, EXTENSION_ORIGIN, EXTENSION_SIGNIN_ORIGIN]

/** What the setting adds to the apps' own origins, which are always there. */
const origins = (value: string | undefined): string[] =>
  [...allowedOrigins(value, silent as never)].filter(origin => !OWN.includes(origin)).sort()

describe('allowedOrigins', () => {
  it('takes the origin of each address, however it was written', () => {
    expect(origins('https://xiao215.github.io/selfmp3/, http://localhost:4601')).toEqual([
      'http://localhost:4601',
      'https://xiao215.github.io',
    ])
  })

  it('ignores blanks and an empty setting', () => {
    expect(origins('')).toEqual([])
    expect(origins(undefined)).toEqual([])
    expect(origins(' , ,https://a.example, ')).toEqual(['https://a.example'])
  })

  /*
   * The important one. A URL whose scheme is not a web scheme reports its
   * origin as the literal string "null" — which is exactly what a browser
   * sends from a sandboxed frame, so one mistyped entry would have put every
   * opaque context on the list rather than none.
   */
  it('never lets a mistyped entry become the opaque origin', () => {
    for (const entry of ['mailto:me@example.com', 'about:blank', 'file:///tmp/app', 'not a url']) {
      expect(origins(entry), entry).toEqual([])
    }
  })

  it('refuses a scheme a browser hands out itself', () => {
    expect(origins('ftp://example.com')).toEqual([])
    expect(origins('blob:https://xiao215.github.io/abc')).toEqual([])
    expect(origins('file://localhost')).toEqual([])
    expect(origins('data://x')).toEqual([])
  })

  /*
   * The installed desktop app's page is served from its own scheme, and a browser
   * sends that origin exactly as written — a made-up scheme has no origin rules.
   * Without this, the first sign-in from the app was refused with nothing on
   * screen but "Failed to fetch".
   */
  it('takes an installed app’s own scheme, as the browser sends it', () => {
    expect(origins('app://player')).toEqual(['app://player'])
    expect(origins('app://player/')).toEqual(['app://player'])
    expect(origins('APP://Player')).toEqual(['app://player'])
    expect(origins('https://xiao215.github.io,app://player')).toEqual([
      'app://player',
      'https://xiao215.github.io',
    ])
  })

  it('takes nothing but a bare scheme and host for an installed app', () => {
    for (const entry of [
      'app://selfmp3/page',
      'app://selfmp3?x=1',
      'app://selfmp3#f',
      'app://',
      'app://me@selfmp3',
    ]) {
      expect(origins(entry), entry).toEqual([])
    }
  })

  /*
   * The desktop app's page, and the browser extension, which sends its own
   * origin on every write and has its sign-in come back through Chrome's
   * address for it. All three are the same on every install, so they are on
   * the list without being in the setting.
   */
  it('always takes the desktop app’s and the extension’s own origins', () => {
    for (const value of [undefined, '', 'https://xiao215.github.io', EXTENSION_ORIGIN]) {
      const list = [...allowedOrigins(value, silent as never)]
      expect(list, String(value)).toEqual(expect.arrayContaining(OWN))
    }
    expect(OWN).toEqual([
      'app://selfmp3',
      'chrome-extension://ojgfoohmmkangonahnbdpelfgmkjkfpi',
      'https://ojgfoohmmkangonahnbdpelfgmkjkfpi.chromiumapp.org',
    ])
  })

  it('keeps the good entries when one alongside them is bad', () => {
    expect(origins('mailto:me@example.com,https://xiao215.github.io')).toEqual([
      'https://xiao215.github.io',
    ])
  })
})
