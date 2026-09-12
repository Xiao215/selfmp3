/**
 * Where the server is, and how to make sense of what someone typed.
 *
 * Moved from `apps/mobile/src/server/connection.ts`, minus the keychain. The
 * reading and writing stayed in the phone app because `expo-secure-store` is
 * the phone's; the *rules* came here because they are not, and because the
 * universal app will need exactly the same ones in a browser.
 */

import type { ApiTransport } from '../platform.js'

export interface ServerConnection {
  /** Origin with no trailing slash, e.g. `https://mac-mini.tail1234.ts.net`. */
  readonly baseUrl: string
  /** Optional bearer token, when the server has one configured. */
  readonly token: string | null
}

/**
 * Accept what someone would actually type — `mac-mini.tail1234.ts.net`, with
 * or without a scheme, with or without a trailing slash — and return a usable
 * origin, or null when it cannot be salvaged.
 *
 * A missing scheme is guessed from whether a port was named, because the two
 * ways of reaching the Mac differ in exactly that. `tailscale serve --bg 4600`
 * (docs/SETUP.md) puts the server behind Tailscale's own HTTPS on 443, so a
 * bare hostname is `https://`. A port typed out is someone reaching the server
 * directly, which is plain HTTP. Guessing `http://` for both — which is what
 * this did — makes the address the setup guide produces impossible to enter.
 *
 * Parsed by hand rather than with `URL`, which this package cannot use: it is
 * not in the ES2023 library it compiles against, and the version React Native
 * supplies is only partly the standard one. Since the whole job is "make one
 * address out of one line someone typed", string work is both honest and
 * portable — and this is the function where a wrong answer means the phone
 * cannot reach the Mac at all, so it is also the one most worth being able to
 * test anywhere.
 *
 * The behaviour is `URL`'s, deliberately, for the parts that matter here: the
 * host is lower-cased, a default port (443 for https, 80 for http) is dropped,
 * and a query string or fragment is discarded. `connection.test.ts` checks each
 * of those, and checks this against `URL` itself on the shapes a person types.
 */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const scheme = /:\d+(?:\/|$)/.test(trimmed) ? 'http' : 'https'
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`

  const match = /^(https?):\/\/([^/?#]*)([^?#]*)/i.exec(withScheme)
  if (!match) return null

  const protocol = match[1]!.toLowerCase()
  const authority = match[2]!
  const rawPath = match[3] ?? ''

  // `user:pw@host` loses the credentials and keeps the host, which is what
  // `URL` does. Worth knowing that it is a silent drop rather than a refusal:
  // someone who types credentials here gets unauthenticated requests and no
  // explanation. Refusing would be kinder, but this is a move, and changing
  // behaviour inside one is how a regression hides. See the note in
  // docs/UNIVERSAL.md.
  const at = authority.lastIndexOf('@')
  const hostPort = at === -1 ? authority : authority.slice(at + 1)

  const port = /:(\d*)$/.exec(hostPort)
  const hostname = (port ? hostPort.slice(0, port.index) : hostPort).toLowerCase()
  if (hostname.length === 0) return null

  // What a host may be made of. Underscores are in the set on purpose: they are
  // not legal in a hostname by the letter of the RFC, but local DNS and Docker
  // hand them out and `URL` accepts them, so refusing would break a real
  // address. The one place this is deliberately stricter than `URL` is a
  // unicode host, which `URL` converts to punycode using a table this package
  // is not going to carry — refused rather than mangled. A bracketed IPv6
  // literal is the one host that may hold colons.
  const validHost = /^[a-z0-9._-]+$/.test(hostname) || /^\[[0-9a-f:.]+\]$/.test(hostname)
  if (!validHost) return null

  const digits = port?.[1] ?? ''
  const isDefault =
    digits === '' ||
    (protocol === 'https' && digits === '443') ||
    (protocol === 'http' && digits === '80')
  const host = isDefault ? hostname : `${hostname}:${digits}`

  // Keep any path prefix (someone may reverse-proxy at /music) but drop the
  // trailing slash so joining with `/api/...` never doubles up.
  const path = rawPath.replace(/\/+$/, '')
  return `${protocol}://${host}${path}`
}

/**
 * The transport for a phone-shaped client: an absolute address it was told
 * about, with a bearer token if the server has one.
 *
 * The browser does not use this — it talks to its own origin under a base path
 * and carries no credentials, because Tailscale is the security boundary — so
 * this is the one place the two genuinely differ, and it is eight lines.
 */
export function serverTransport(connection: ServerConnection): ApiTransport {
  const token = connection.token

  return {
    url: (path: string) => `${connection.baseUrl}${path}`,
    headers: (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    // The OS audio player and CarPlay's image loader cannot send a header.
    mediaParams: (): Record<string, string> => (token ? { token } : {}),
  }
}
