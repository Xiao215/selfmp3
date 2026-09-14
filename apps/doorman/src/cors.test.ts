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

const origins = (value: string | undefined): string[] =>
  [...allowedOrigins(value, silent as never)].sort()

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
    expect(origins('app://selfmp3')).toEqual(['app://selfmp3'])
    expect(origins('app://selfmp3/')).toEqual(['app://selfmp3'])
    expect(origins('APP://SelfMP3')).toEqual(['app://selfmp3'])
    expect(origins('https://xiao215.github.io,app://selfmp3')).toEqual([
      'app://selfmp3',
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

  it('keeps the good entries when one alongside them is bad', () => {
    expect(origins('mailto:me@example.com,https://xiao215.github.io')).toEqual([
      'https://xiao215.github.io',
    ])
  })
})
