import { describe, expect, it } from 'vitest'

import { normaliseBaseUrl, serverTransport } from './connection.js'

/**
 * `normaliseBaseUrl` had no tests while it lived in the phone app, which is the
 * wrong way round: it is the one function where a wrong answer means the phone
 * cannot reach the Mac at all, and it is pure, so it is the cheapest thing in
 * the repository to test.
 *
 * The cases below are the shapes a person actually types, plus the corners that
 * came up while moving it off `URL` — which this package cannot use, since it
 * compiles without the DOM and React Native's own `URL` is only partly the
 * standard one.
 */
describe('normaliseBaseUrl', () => {
  it('takes a bare Tailscale name as https', () => {
    // `tailscale serve --bg 4600` puts the server behind Tailscale's HTTPS on
    // 443, so this is the address docs/SETUP.md tells someone to use.
    expect(normaliseBaseUrl('mac-mini.tail1234.ts.net')).toBe(
      'https://mac-mini.tail1234.ts.net',
    )
  })

  it('takes a named port as http', () => {
    // A port typed out is someone reaching the server directly, which is plain
    // HTTP. Guessing https for both makes the setup guide's address unusable.
    expect(normaliseBaseUrl('mac-mini.tail1234.ts.net:4600')).toBe(
      'http://mac-mini.tail1234.ts.net:4600',
    )
    expect(normaliseBaseUrl('192.168.1.10:4600')).toBe('http://192.168.1.10:4600')
  })

  it('keeps an explicit scheme', () => {
    expect(normaliseBaseUrl('http://mac-mini.local')).toBe('http://mac-mini.local')
    expect(normaliseBaseUrl('https://mac-mini.local:4600')).toBe(
      'https://mac-mini.local:4600',
    )
  })

  it('forgives whitespace and trailing slashes', () => {
    expect(normaliseBaseUrl('  mac-mini.local  ')).toBe('https://mac-mini.local')
    expect(normaliseBaseUrl('mac-mini.local///')).toBe('https://mac-mini.local')
  })

  it('lower-cases the host but not the path', () => {
    // Hosts are case-insensitive; a reverse proxy's path is not, and someone
    // proxying at /Music means /Music.
    expect(normaliseBaseUrl('HTTPS://Mac.Local/Music')).toBe('https://mac.local/Music')
  })

  it('drops a default port and keeps any other', () => {
    expect(normaliseBaseUrl('https://mac.local:443')).toBe('https://mac.local')
    expect(normaliseBaseUrl('http://mac.local:80')).toBe('http://mac.local')
    expect(normaliseBaseUrl('https://mac.local:8443')).toBe('https://mac.local:8443')
  })

  it('keeps a path prefix, for anyone reverse-proxying at /music', () => {
    expect(normaliseBaseUrl('http://192.168.1.10:4600/music/')).toBe(
      'http://192.168.1.10:4600/music',
    )
  })

  it('discards a query string or fragment', () => {
    // Nobody types these on purpose, but a pasted address can carry one, and
    // joining it with `/api/...` would produce nonsense.
    expect(normaliseBaseUrl('mac.local/music?x=1')).toBe('https://mac.local/music')
    expect(normaliseBaseUrl('mac.local/music#frag')).toBe('https://mac.local/music')
  })

  it('accepts a bracketed IPv6 literal', () => {
    expect(normaliseBaseUrl('[::1]:4600')).toBe('http://[::1]:4600')
    expect(normaliseBaseUrl('http://[2001:DB8::1]/x')).toBe('http://[2001:db8::1]/x')
  })

  it('accepts an underscore in the host', () => {
    // Not legal by the letter of the RFC, but local DNS and Docker hand them
    // out and the browser accepts them, so refusing would break a real address.
    expect(normaliseBaseUrl('mac_mini.local')).toBe('https://mac_mini.local')
  })

  it('drops credentials rather than refusing them', () => {
    // What `URL` does, kept deliberately so the move changed no behaviour.
    // Worth knowing it is silent: someone who types credentials here gets
    // unauthenticated requests and no explanation. The token field is the way.
    expect(normaliseBaseUrl('http://user:pw@mac.local:4600')).toBe(
      'http://mac.local:4600',
    )
  })

  it('refuses a unicode host rather than mangling it', () => {
    // The one deliberate difference from `URL`, which would punycode this to
    // `xn--mc-via.local` using a table this package is not going to carry.
    expect(normaliseBaseUrl('mäc.local')).toBeNull()
  })

  it('refuses what cannot be salvaged', () => {
    expect(normaliseBaseUrl('')).toBeNull()
    expect(normaliseBaseUrl('   ')).toBeNull()
    expect(normaliseBaseUrl('http://')).toBeNull()
    expect(normaliseBaseUrl('://nope')).toBeNull()
    expect(normaliseBaseUrl('mac mini.local')).toBeNull()
  })
})

describe('serverTransport', () => {
  it('joins the address with an API path', () => {
    const t = serverTransport({ baseUrl: 'https://mac.local', token: null })
    expect(t.url('/api/library')).toBe('https://mac.local/api/library')
  })

  it('sends the token as a bearer header', () => {
    const t = serverTransport({ baseUrl: 'https://mac.local', token: 'abc' })
    expect(t.headers()).toEqual({ Authorization: 'Bearer abc' })
  })

  it('also puts the token in media URLs, which cannot carry a header', () => {
    // The OS audio player and CarPlay's image loader take a URL and nothing
    // else, so this is the only way a stream reaches an authenticated server.
    const t = serverTransport({ baseUrl: 'https://mac.local', token: 'abc' })
    expect(t.mediaParams()).toEqual({ token: 'abc' })
  })

  it('sends nothing when there is no token', () => {
    const t = serverTransport({ baseUrl: 'https://mac.local', token: null })
    expect(t.headers()).toEqual({})
    expect(t.mediaParams()).toEqual({})
  })
})
